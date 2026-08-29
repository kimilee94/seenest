import { createActiveTimeTracker } from '../src/activity/active-time-tracker';
import { createCaptureRunner } from '../src/adapters/capture-runner';
import { xAdapter } from '../src/adapters/x';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';
import { installExtensionContextInvalidationGuard } from '../src/utils/extension-context';

// X 的正文通常先出现，图片、视频封面和互动数据会随后异步挂载。
const CONTENT_SETTLE_PERIOD_MS = 3_000;

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  main() {
    installExtensionContextInvalidationGuard();
    const activeTimeTracker = createActiveTimeTracker();
    const runner = createCaptureRunner({
      adapter: xAdapter,
      settleMs: CONTENT_SETTLE_PERIOD_MS,
      maxWaitMs: 15_000,
      observeDom: true,
      isEnabled: async () => {
        const settings = await getSettings();
        return settings.captureEnabled && settings.enabledSources.x;
      },
      onRouteLeave: () => activeTimeTracker.stop(),
      onCaptured: async ({ result: memory, visit }) => {
        const message: SeenestMessage = { type: 'SEENEST_RECORD', payload: { memory, visit } };
        const response = await browser.runtime.sendMessage(message) as {
          ok?: boolean;
          memoryId?: string;
          visitId?: string;
        } | undefined;
        if (response?.ok && response.memoryId && response.visitId) {
          activeTimeTracker.start(response.memoryId, response.visitId);
        }
      },
    });

    // 弹窗或管理页改变全局/平台开关后，当前详情页无需刷新即可同步启停。
    browser.storage.onChanged.addListener((changes, area) => {
      const next = changes.seenestSettings?.newValue as {
        captureEnabled?: boolean;
        enabledSources?: { x?: boolean };
      } | undefined;
      if (area !== 'local' || !next) return;
      if (next.captureEnabled && next.enabledSources?.x !== false) runner.restart();
      else runner.stop();
    });

    runner.start();
  },
});
