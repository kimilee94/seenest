import { upsertCapturedRecord } from '../src/db/history-repository';
import { parseBilibiliViewResponse, type BilibiliViewResponse } from '../src/parsers/bilibili/parser';
import { isValidBvid } from '../src/parsers/bilibili/route';
import {
  BILIBILI_CONTENT_SCRIPT_FILE,
  BILIBILI_CONTENT_SCRIPT_ID,
  BILIBILI_OPTIONAL_ORIGINS,
  BILIBILI_PAGE_ORIGIN,
} from '../src/sources/bilibili';
import {
  BILIBILI_REQUEST_GUARD_KEY,
  DEFAULT_BILIBILI_REQUEST_GUARD,
  canRequestBilibili,
  markBilibiliRequestFailed,
  markBilibiliRequestStarted,
  markBilibiliRequestSucceeded,
  type BilibiliRequestGuardState,
} from '../src/sources/bilibili-request-guard';
import { writeAutoBackupSnapshot } from '../src/storage/auto-backup';
import { ensurePersistentStorage } from '../src/storage/persistence';
import { DEFAULT_SETTINGS, getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

const AUTO_BACKUP_ALARM_NAME = 'seenest-auto-backup';
const AUTO_BACKUP_DELAY_MS = 30_000;
let bilibiliRequestInFlight = false;

/**
 * 把自动备份安排在最后一次记录变化的约 30 秒后。
 * 同名 alarm 会覆盖前一次安排，因此连续浏览只会在安静下来后写一次文件。
 */
function scheduleAutoBackup(): void {
  void browser.alarms.create(AUTO_BACKUP_ALARM_NAME, {
    when: Date.now() + AUTO_BACKUP_DELAY_MS,
  });
}

// 只接收来自 X / Twitter 页面注入脚本的采集消息，防止其他页面伪造记录写入本地数据库。
function isTrustedXSender(url?: string): boolean {
  if (!url) return false;
  try {
    return ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isTrustedBilibiliSender(url?: string): boolean {
  if (!url) return false;
  try {
    return ['bilibili.com', 'www.bilibili.com'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 根据用户的平台开关注册或撤销 B 站采集脚本；已有网站权限不会在暂停时擅自删除。 */
async function syncBilibiliContentScript(): Promise<void> {
  const settings = await getSettings();
  const hasPermission = await browser.permissions.contains({ origins: BILIBILI_OPTIONAL_ORIGINS });
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [BILIBILI_CONTENT_SCRIPT_ID] });
  const shouldRegister = settings.enabledSources.bilibili && hasPermission;

  if (shouldRegister && !registered.length) {
    await browser.scripting.registerContentScripts([{
      id: BILIBILI_CONTENT_SCRIPT_ID,
      js: [BILIBILI_CONTENT_SCRIPT_FILE],
      matches: [BILIBILI_PAGE_ORIGIN],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    }]);
  } else if (!shouldRegister && registered.length) {
    await browser.scripting.unregisterContentScripts({ ids: [BILIBILI_CONTENT_SCRIPT_ID] });
  }
}

async function readBilibiliRequestGuard(): Promise<BilibiliRequestGuardState> {
  const stored = await browser.storage.local.get(BILIBILI_REQUEST_GUARD_KEY);
  return { ...DEFAULT_BILIBILI_REQUEST_GUARD, ...(stored[BILIBILI_REQUEST_GUARD_KEY] as Partial<BilibiliRequestGuardState> | undefined) };
}

async function writeBilibiliRequestGuard(state: BilibiliRequestGuardState): Promise<void> {
  await browser.storage.local.set({ [BILIBILI_REQUEST_GUARD_KEY]: state });
}

/** 解析 Retry-After 的秒数或 HTTP 日期；非法值交给本地指数退避。 */
function parseRetryAfter(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

/** 每次视频访问最多请求一次公开详情接口，并在后台统一执行限流与失败退避。 */
async function captureBilibiliVideo(bvid: string, visitedAt: string) {
  if (!isValidBvid(bvid) || bilibiliRequestInFlight) return null;
  bilibiliRequestInFlight = true;
  try {
    const now = Date.now();
    let guard = await readBilibiliRequestGuard();
    if (!canRequestBilibili(guard, now).allowed) return null;

    // 发出网络请求前先落盘，后台 Service Worker 重启也不会丢失限流状态。
    guard = markBilibiliRequestStarted(guard, now);
    await writeBilibiliRequestGuard(guard);
    const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!response.ok) {
      if ([403, 412, 429].includes(response.status) || response.status >= 500) {
        guard = markBilibiliRequestFailed(guard, response.status, Date.now(), parseRetryAfter(response.headers.get('retry-after'), Date.now()));
        await writeBilibiliRequestGuard(guard);
      }
      return null;
    }

    const payload = await response.json() as BilibiliViewResponse;
    // B 站有时会用 HTTP 200 包装 -403/-412/-429 业务码，同样视为保护信号。
    const platformStatus = Math.abs(payload.code);
    if ([403, 412, 429].includes(platformStatus)) {
      await writeBilibiliRequestGuard(markBilibiliRequestFailed(guard, platformStatus, Date.now()));
      return null;
    }

    const record = parseBilibiliViewResponse(payload, new Date(visitedAt));
    if (record) await writeBilibiliRequestGuard(markBilibiliRequestSucceeded(guard));
    return record;
  } catch {
    const guard = await readBilibiliRequestGuard();
    await writeBilibiliRequestGuard(markBilibiliRequestFailed(guard, 'network', Date.now()));
    return null;
  } finally {
    bilibiliRequestInFlight = false;
  }
}

export default defineBackground(() => {
  // 每次后台启动时确认扩展存储处于持久化状态；失败不会影响正常采集和读取。
  void ensurePersistentStorage();
  void syncBilibiliContentScript();

  // 首次安装时写入默认设置；升级扩展不会覆盖用户已有的开关状态。
  browser.runtime.onInstalled.addListener(async () => {
    const current = await browser.storage.local.get('seenestSettings');
    if (!current.seenestSettings) await browser.storage.local.set({ seenestSettings: DEFAULT_SETTINGS });
    await syncBilibiliContentScript();
  });

  // alarm 到期后写入完整 JSON 快照；未开启或授权失效时会静默跳过，不影响页面采集。
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_BACKUP_ALARM_NAME) await writeAutoBackupSnapshot();
  });

  // 后台是内容采集与本地存储之间的唯一入口，负责校验来源、读取开关并执行去重写入。
  browser.runtime.onMessage.addListener(async (message: SeenestMessage, sender) => {
    if (message.type === 'SEENEST_RECORD') {
      if (!isTrustedXSender(sender.url ?? sender.tab?.url)) return { ok: false };
      const settings = await getSettings();
      if (!settings.captureEnabled || !settings.enabledSources.x) return { ok: false };
      await upsertCapturedRecord(message.payload);
      scheduleAutoBackup();
      return { ok: true };
    }

    if (message.type === 'SEENEST_BILIBILI_CAPTURE') {
      if (!isTrustedBilibiliSender(sender.url ?? sender.tab?.url)) return { ok: false };
      const settings = await getSettings();
      if (!settings.captureEnabled || !settings.enabledSources.bilibili) return { ok: false };
      const record = await captureBilibiliVideo(message.payload.bvid, message.payload.visitedAt);
      if (!record) return { ok: false };
      await upsertCapturedRecord(record);
      scheduleAutoBackup();
      return { ok: true };
    }

    if (message.type === 'SEENEST_SYNC_SOURCE_REGISTRATION') {
      await syncBilibiliContentScript();
      return { ok: true };
    }

    if (message.type === 'SEENEST_OPEN_DASHBOARD') {
      await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html') });
      return { ok: true };
    }

    if (message.type === 'SEENEST_CAPTURE_STATE') {
      return { ok: true, settings: await getSettings() };
    }

    return undefined;
  });
});
