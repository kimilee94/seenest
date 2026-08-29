import { createActiveTimeTracker } from '../src/activity/active-time-tracker';
import { createCaptureRunner } from '../src/adapters/capture-runner';
import { githubAdapter } from '../src/adapters/github';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

export default defineContentScript({
  // 该入口由后台在用户授予 github.com 可选权限后动态注册，不会随扩展默认注入。
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    const activeTimeTracker = createActiveTimeTracker();
    const runner = createCaptureRunner({
      adapter: githubAdapter,
      settleMs: 3_000,
      maxWaitMs: 60_000,
      observeDom: true,
      async isEnabled() {
        const settings = await getSettings();
        return settings.captureEnabled
          && settings.enabledSources.github
          && document.visibilityState === 'visible'
          && document.hasFocus();
      },
      onRouteLeave() {
        activeTimeTracker.stop();
      },
      async onCaptured({ result: memory, visit }) {
        const message: SeenestMessage = { type: 'SEENEST_RECORD', payload: { memory, visit } };
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
          // 后台暂时不可用时不循环提交，避免同一次页面访问产生重复 Visit。
        }
      },
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.seenestSettings) return;
      const next = changes.seenestSettings.newValue as {
        captureEnabled?: boolean;
        enabledSources?: { github?: boolean };
      } | undefined;
      if (next?.captureEnabled && next.enabledSources?.github !== false) runner.restart();
      else runner.stop();
    });

    // 后台标签不会解析；用户真正回到页面时再补做一次等待与采集。
    window.addEventListener('focus', runner.ensure);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') runner.ensure();
    });
    runner.start();
  },
});
