import { upsertCapturedRecord } from '../src/db/history-repository';
import { DEFAULT_SETTINGS, getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

function isTrustedXSender(url?: string): boolean {
  if (!url) return false;
  try {
    return ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const current = await browser.storage.local.get('seenestSettings');
    if (!current.seenestSettings) await browser.storage.local.set({ seenestSettings: DEFAULT_SETTINGS });
  });

  browser.runtime.onMessage.addListener(async (message: SeenestMessage, sender) => {
    if (message.type === 'SEENEST_RECORD') {
      if (!isTrustedXSender(sender.url ?? sender.tab?.url)) return { ok: false };
      if (!(await getSettings()).captureEnabled) return { ok: false };
      await upsertCapturedRecord(message.payload);
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
