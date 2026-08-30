import {
  endVisit,
  incrementActiveDuration,
  recordCapturedMemoryVisit,
  recordVisitForExistingMemory,
} from '../src/db/history-repository';
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
import {
  GITHUB_CONTENT_SCRIPT_FILE,
  GITHUB_CONTENT_SCRIPT_ID,
  GITHUB_OPTIONAL_ORIGINS,
  GITHUB_PAGE_ORIGIN,
} from '../src/sources/github';
import {
  YOUTUBE_CONTENT_SCRIPT_FILE,
  YOUTUBE_CONTENT_SCRIPT_ID,
  YOUTUBE_OPTIONAL_ORIGINS,
  YOUTUBE_PAGE_ORIGIN,
} from '../src/sources/youtube';
import {
  XIAOHONGSHU_CONTENT_SCRIPT_FILE,
  XIAOHONGSHU_CONTENT_SCRIPT_ID,
  XIAOHONGSHU_OPTIONAL_ORIGINS,
  XIAOHONGSHU_PAGE_ORIGINS,
} from '../src/sources/xiaohongshu';
import { writeAutoBackupSnapshot } from '../src/storage/auto-backup';
import { ensurePersistentStorage } from '../src/storage/persistence';
import { DEFAULT_SETTINGS, getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

const AUTO_BACKUP_ALARM_NAME = 'seenest-auto-backup';
const AUTO_BACKUP_DELAY_MS = 30_000;
const ACTIVE_TIME_IDLE_THRESHOLD_SECONDS = 90;
let bilibiliRequestInFlight = false;
let bilibiliContentScriptSyncQueue: Promise<void> = Promise.resolve();
let githubContentScriptSyncQueue: Promise<void> = Promise.resolve();
let youtubeContentScriptSyncQueue: Promise<void> = Promise.resolve();
let xiaohongshuContentScriptSyncQueue: Promise<void> = Promise.resolve();

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

function isTrustedGithubSender(url?: string): boolean {
  if (!url) return false;
  try {
    return ['github.com', 'www.github.com'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isTrustedYoutubeSender(url?: string): boolean {
  if (!url) return false;
  try {
    return ['youtube.com', 'www.youtube.com'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isTrustedXiaohongshuSender(url?: string): boolean {
  if (!url) return false;
  try {
    return ['xiaohongshu.com', 'www.xiaohongshu.com'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 普通 DOM 采集消息只允许写入与发送页面一致的平台前缀。 */
function trustedMemorySource(url: string | undefined, memoryId: string): 'x' | 'github' | 'youtube' | 'xiaohongshu' | '' {
  if (isTrustedXSender(url) && memoryId.startsWith('x:')) return 'x';
  if (isTrustedGithubSender(url) && memoryId.startsWith('github:')) return 'github';
  if (isTrustedYoutubeSender(url) && memoryId.startsWith('youtube:')) return 'youtube';
  if (isTrustedXiaohongshuSender(url) && memoryId.startsWith('xiaohongshu:')) return 'xiaohongshu';
  return '';
}

/** 同时校验发送页面、Memory ID 与 Visit ID 的平台前缀，阻止跨来源修改访问数据。 */
function trustedActivitySource(url: string | undefined, memoryId: string, visitId: string): 'x' | 'bilibili' | 'github' | 'youtube' | 'xiaohongshu' | '' {
  if (isTrustedXSender(url) && memoryId.startsWith('x:') && visitId.startsWith('x:visit:')) return 'x';
  if (isTrustedBilibiliSender(url) && memoryId.startsWith('bilibili:') && visitId.startsWith('bilibili:visit:')) return 'bilibili';
  if (isTrustedGithubSender(url) && memoryId.startsWith('github:') && visitId.startsWith('github:visit:')) return 'github';
  if (isTrustedYoutubeSender(url) && memoryId.startsWith('youtube:') && visitId.startsWith('youtube:visit:')) return 'youtube';
  if (isTrustedXiaohongshuSender(url) && memoryId.startsWith('xiaohongshu:') && visitId.startsWith('xiaohongshu:visit:')) return 'xiaohongshu';
  return '';
}

/** 判断动态脚本错误是否只是浏览器状态已由另一条并发流程完成，便于安全地按幂等操作处理。 */
function isExpectedContentScriptStateError(error: unknown, phrase: string): boolean {
  return error instanceof Error && error.message.toLowerCase().includes(phrase.toLowerCase());
}

/** 根据用户的平台开关注册或撤销 B 站采集脚本；调用方通过串行队列避免重复注册竞争。 */
async function reconcileBilibiliContentScript(): Promise<void> {
  const settings = await getSettings();
  const hasPermission = await browser.permissions.contains({ origins: BILIBILI_OPTIONAL_ORIGINS });
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [BILIBILI_CONTENT_SCRIPT_ID] });
  const shouldRegister = settings.enabledSources.bilibili && hasPermission;

  if (shouldRegister && !registered.length) {
    try {
      await browser.scripting.registerContentScripts([{
        id: BILIBILI_CONTENT_SCRIPT_ID,
        js: [BILIBILI_CONTENT_SCRIPT_FILE],
        matches: [BILIBILI_PAGE_ORIGIN],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
    } catch (error) {
      // Chrome 可能在查询与注册之间恢复持久化脚本，此时重复 ID 表示目标状态已经达成。
      if (!isExpectedContentScriptStateError(error, 'duplicate script id')) throw error;
    }
  } else if (!shouldRegister && registered.length) {
    try {
      await browser.scripting.unregisterContentScripts({ ids: [BILIBILI_CONTENT_SCRIPT_ID] });
    } catch (error) {
      // 另一条同步流程已经撤销脚本时无需再次报错。
      if (!isExpectedContentScriptStateError(error, 'non-existent script id')) throw error;
    }
  }
}

/**
 * 后台启动、扩展升级和设置消息都可能同时要求同步脚本。
 * 所有操作进入同一串行队列，并在这里收口异常，避免产生未处理的 Promise rejection。
 */
function syncBilibiliContentScript(): Promise<void> {
  const task = bilibiliContentScriptSyncQueue.then(reconcileBilibiliContentScript, reconcileBilibiliContentScript);
  bilibiliContentScriptSyncQueue = task.catch((error) => {
    console.warn('[Seenest] Failed to sync Bilibili content script:', error);
  });
  return bilibiliContentScriptSyncQueue;
}

/** GitHub 属于可选来源，仅在用户授权且开关开启时动态注册内容脚本。 */
async function reconcileGithubContentScript(): Promise<void> {
  const settings = await getSettings();
  const hasPermission = await browser.permissions.contains({ origins: GITHUB_OPTIONAL_ORIGINS });
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [GITHUB_CONTENT_SCRIPT_ID] });
  const shouldRegister = settings.enabledSources.github && hasPermission;

  if (shouldRegister && !registered.length) {
    try {
      await browser.scripting.registerContentScripts([{
        id: GITHUB_CONTENT_SCRIPT_ID,
        js: [GITHUB_CONTENT_SCRIPT_FILE],
        matches: [GITHUB_PAGE_ORIGIN],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
    } catch (error) {
      if (!isExpectedContentScriptStateError(error, 'duplicate script id')) throw error;
    }
  } else if (!shouldRegister && registered.length) {
    try {
      await browser.scripting.unregisterContentScripts({ ids: [GITHUB_CONTENT_SCRIPT_ID] });
    } catch (error) {
      if (!isExpectedContentScriptStateError(error, 'non-existent script id')) throw error;
    }
  }
}

function syncGithubContentScript(): Promise<void> {
  const task = githubContentScriptSyncQueue.then(reconcileGithubContentScript, reconcileGithubContentScript);
  githubContentScriptSyncQueue = task.catch((error) => {
    console.warn('[Seenest] Failed to sync GitHub content script:', error);
  });
  return githubContentScriptSyncQueue;
}

/** YouTube 仅解析用户已打开的标准视频页面，不调用 Data API。 */
async function reconcileYoutubeContentScript(): Promise<void> {
  const settings = await getSettings();
  const hasPermission = await browser.permissions.contains({ origins: YOUTUBE_OPTIONAL_ORIGINS });
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [YOUTUBE_CONTENT_SCRIPT_ID] });
  const shouldRegister = settings.enabledSources.youtube && hasPermission;

  if (shouldRegister && !registered.length) {
    try {
      await browser.scripting.registerContentScripts([{
        id: YOUTUBE_CONTENT_SCRIPT_ID,
        js: [YOUTUBE_CONTENT_SCRIPT_FILE],
        matches: [YOUTUBE_PAGE_ORIGIN],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
    } catch (error) {
      if (!isExpectedContentScriptStateError(error, 'duplicate script id')) throw error;
    }
  } else if (!shouldRegister && registered.length) {
    try {
      await browser.scripting.unregisterContentScripts({ ids: [YOUTUBE_CONTENT_SCRIPT_ID] });
    } catch (error) {
      if (!isExpectedContentScriptStateError(error, 'non-existent script id')) throw error;
    }
  }
}

function syncYoutubeContentScript(): Promise<void> {
  const task = youtubeContentScriptSyncQueue.then(reconcileYoutubeContentScript, reconcileYoutubeContentScript);
  youtubeContentScriptSyncQueue = task.catch((error) => {
    console.warn('[Seenest] Failed to sync YouTube content script:', error);
  });
  return youtubeContentScriptSyncQueue;
}

/** 小红书仅在用户授权后注入，详情页解析完全来自当前页面公开 DOM。 */
async function reconcileXiaohongshuContentScript(): Promise<void> {
  const settings = await getSettings();
  const hasPermission = await browser.permissions.contains({ origins: XIAOHONGSHU_OPTIONAL_ORIGINS });
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [XIAOHONGSHU_CONTENT_SCRIPT_ID] });
  const shouldRegister = settings.enabledSources.xiaohongshu && hasPermission;

  if (shouldRegister && !registered.length) {
    try {
      await browser.scripting.registerContentScripts([{
        id: XIAOHONGSHU_CONTENT_SCRIPT_ID,
        js: [XIAOHONGSHU_CONTENT_SCRIPT_FILE],
        matches: XIAOHONGSHU_PAGE_ORIGINS,
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
    } catch (error) {
      if (!isExpectedContentScriptStateError(error, 'duplicate script id')) throw error;
    }
  } else if (!shouldRegister && registered.length) {
    try {
      await browser.scripting.unregisterContentScripts({ ids: [XIAOHONGSHU_CONTENT_SCRIPT_ID] });
    } catch (error) {
      if (!isExpectedContentScriptStateError(error, 'non-existent script id')) throw error;
    }
  }
}

function syncXiaohongshuContentScript(): Promise<void> {
  const task = xiaohongshuContentScriptSyncQueue.then(reconcileXiaohongshuContentScript, reconcileXiaohongshuContentScript);
  xiaohongshuContentScriptSyncQueue = task.catch((error) => {
    console.warn('[Seenest] Failed to sync Xiaohongshu content script:', error);
  });
  return xiaohongshuContentScriptSyncQueue;
}

async function syncOptionalContentScripts(): Promise<void> {
  await Promise.all([syncBilibiliContentScript(), syncGithubContentScript(), syncYoutubeContentScript(), syncXiaohongshuContentScript()]);
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
async function captureBilibiliVideo(bvid: string) {
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

    const record = parseBilibiliViewResponse(payload);
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
  void syncOptionalContentScripts();

  // 首次安装时写入默认设置；升级扩展不会覆盖用户已有的开关状态。
  browser.runtime.onInstalled.addListener(async () => {
    const current = await browser.storage.local.get('seenestSettings');
    if (!current.seenestSettings) await browser.storage.local.set({ seenestSettings: DEFAULT_SETTINGS });
    await syncOptionalContentScripts();
  });

  // alarm 到期后写入完整 JSON 快照；未开启或授权失效时会静默跳过，不影响页面采集。
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_BACKUP_ALARM_NAME) await writeAutoBackupSnapshot();
  });

  // 后台是内容采集与本地存储之间的唯一入口，负责校验来源、读取开关并执行去重写入。
  browser.runtime.onMessage.addListener(async (message: SeenestMessage, sender) => {
    if (message.type === 'SEENEST_RECORD') {
      const source = trustedMemorySource(sender.url ?? sender.tab?.url, message.payload.memory.id);
      if (!source || message.payload.memory.source !== source) return { ok: false };
      const settings = await getSettings();
      if (!settings.captureEnabled || !settings.enabledSources[source]) return { ok: false };
      const recorded = await recordCapturedMemoryVisit(message.payload.memory, message.payload.visit, sender.tab?.id);
      scheduleAutoBackup();
      return { ok: true, memoryId: recorded.memory.id, visitId: recorded.visit.id };
    }

    if (message.type === 'SEENEST_BILIBILI_CAPTURE') {
      if (!isTrustedBilibiliSender(sender.url ?? sender.tab?.url)) return { ok: false };
      const settings = await getSettings();
      if (!settings.captureEnabled || !settings.enabledSources.bilibili) return { ok: false };
      const memory = await captureBilibiliVideo(message.payload.bvid);
      // 请求被限流或暂时失败时，如果视频以前已收好，仍保留本次真实访问而不追加网络请求。
      const recorded = memory
        ? await recordCapturedMemoryVisit(memory, message.payload.visit, sender.tab?.id)
        : await recordVisitForExistingMemory(`bilibili:video:${message.payload.bvid}`, message.payload.visit, sender.tab?.id);
      if (!recorded) return { ok: false };
      scheduleAutoBackup();
      return { ok: true, memoryId: recorded.memory.id, visitId: recorded.visit.id };
    }

    if (message.type === 'SEENEST_ACTIVITY_STATE') {
      const trusted = isTrustedXSender(sender.url ?? sender.tab?.url)
        || isTrustedBilibiliSender(sender.url ?? sender.tab?.url)
        || isTrustedGithubSender(sender.url ?? sender.tab?.url)
        || isTrustedYoutubeSender(sender.url ?? sender.tab?.url)
        || isTrustedXiaohongshuSender(sender.url ?? sender.tab?.url);
      if (!trusted) return { ok: false, active: false };
      return { ok: true, active: await browser.idle.queryState(ACTIVE_TIME_IDLE_THRESHOLD_SECONDS) === 'active' };
    }

    if (message.type === 'SEENEST_ACTIVE_TIME') {
      const senderUrl = sender.url ?? sender.tab?.url;
      const source = trustedActivitySource(senderUrl, message.payload.memoryId, message.payload.visitId);
      if (!source) return { ok: false };
      const settings = await getSettings();
      if (!settings.captureEnabled || !settings.enabledSources[source]) return { ok: false };
      const record = await incrementActiveDuration(
        message.payload.memoryId,
        message.payload.visitId,
        message.payload.durationMs,
        message.payload.measuredAt,
      );
      if (!record) return { ok: false };
      scheduleAutoBackup();
      return { ok: true };
    }

    if (message.type === 'SEENEST_VISIT_END') {
      const senderUrl = sender.url ?? sender.tab?.url;
      if (!trustedActivitySource(senderUrl, message.payload.memoryId, message.payload.visitId)) return { ok: false };
      const ok = await endVisit(message.payload.memoryId, message.payload.visitId, message.payload.endedAt);
      if (ok) scheduleAutoBackup();
      return { ok };
    }

    if (message.type === 'SEENEST_SYNC_SOURCE_REGISTRATION') {
      await syncOptionalContentScripts();
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
