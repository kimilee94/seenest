import { upsertCapturedRecord } from '../src/db/history-repository';
import { writeAutoBackupSnapshot } from '../src/storage/auto-backup';
import { ensurePersistentStorage } from '../src/storage/persistence';
import { DEFAULT_SETTINGS, getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

const AUTO_BACKUP_ALARM_NAME = 'seenest-auto-backup';
const AUTO_BACKUP_DELAY_MS = 30_000;

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

export default defineBackground(() => {
  // 每次后台启动时确认扩展存储处于持久化状态；失败不会影响正常采集和读取。
  void ensurePersistentStorage();

  // 首次安装时写入默认设置；升级扩展不会覆盖用户已有的开关状态。
  browser.runtime.onInstalled.addListener(async () => {
    const current = await browser.storage.local.get('seenestSettings');
    if (!current.seenestSettings) await browser.storage.local.set({ seenestSettings: DEFAULT_SETTINGS });
  });

  // alarm 到期后写入完整 JSON 快照；未开启或授权失效时会静默跳过，不影响页面采集。
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === AUTO_BACKUP_ALARM_NAME) await writeAutoBackupSnapshot();
  });

  // 后台是内容采集与本地存储之间的唯一入口，负责校验来源、读取开关并执行去重写入。
  browser.runtime.onMessage.addListener(async (message: SeenestMessage, sender) => {
    if (message.type === 'SEENEST_RECORD') {
      if (!isTrustedXSender(sender.url ?? sender.tab?.url)) return { ok: false };
      if (!(await getSettings()).captureEnabled) return { ok: false };
      await upsertCapturedRecord(message.payload);
      scheduleAutoBackup();
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
