import { createActiveTimeTracker } from '../src/activity/active-time-tracker';
import { bilibiliAdapter } from '../src/adapters/bilibili';
import { createCaptureRunner } from '../src/adapters/capture-runner';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

const CAPTURE_DELAY_MS = 2_000;

export default defineContentScript({
  // 此脚本由后台在用户主动授权 B 站后注册，不写入 manifest 的静态 content_scripts。
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    const activeTimeTracker = createActiveTimeTracker();
    const runner = createCaptureRunner({
      adapter: bilibiliAdapter,
      settleMs: CAPTURE_DELAY_MS,
      maxWaitMs: CAPTURE_DELAY_MS + 1_000,
      observeDom: false,
      isEnabled: async () => {
        const settings = await getSettings();
        return settings.captureEnabled && settings.enabledSources.bilibili;
      },
      onRouteLeave: () => activeTimeTracker.stop(),
      onCaptured: async ({ result, visit }) => {
        const message: SeenestMessage = {
          type: 'SEENEST_BILIBILI_CAPTURE',
          payload: { ...result, visit },
        };
        try {
          const response = await browser.runtime.sendMessage(message) as {
            ok?: boolean;
            memoryId?: string;
            visitId?: string;
          } | undefined;
          if (response?.ok && response.memoryId && response.visitId) {
            activeTimeTracker.start(response.memoryId, response.visitId);
          }
        } catch {
          // 当前页面严格只尝试一次；后台暂时不可用时不循环重试。
        }
      },
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.seenestSettings) return;
      const next = changes.seenestSettings.newValue as {
        captureEnabled?: boolean;
        enabledSources?: { bilibili?: boolean };
      } | undefined;
      if (next?.captureEnabled && next.enabledSources?.bilibili !== false) runner.restart();
      else runner.stop();
    });

    runner.start();
  },
});
