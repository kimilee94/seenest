import { createActiveTimeTracker } from '../src/activity/active-time-tracker';
import { createCaptureRunner } from '../src/adapters/capture-runner';
import { xiaohongshuAdapter } from '../src/adapters/xiaohongshu';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';
import { installExtensionContextInvalidationGuard } from '../src/utils/extension-context';

export default defineContentScript({
  // 该入口只在用户主动授权小红书后动态注册，列表页仍会被 Adapter 拒绝。
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    installExtensionContextInvalidationGuard();
    const activeTimeTracker = createActiveTimeTracker();
    const runner = createCaptureRunner({
      adapter: xiaohongshuAdapter,
      // 小红书存在持续 DOM 更新，不等待“完全静默”；进入详情 4 秒后只解析一次。
      settleMs: 4_000,
      singleAttempt: true,
      maxWaitMs: 5_000,
      observeDom: true,
      async isEnabled() {
        const settings = await getSettings();
        return settings.captureEnabled
          && settings.enabledSources.xiaohongshu
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
          // 页面关闭或扩展更新时停止提交；同一次详情访问不会循环写入。
        }
      },
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.seenestSettings) return;
      const next = changes.seenestSettings.newValue as {
        captureEnabled?: boolean;
        enabledSources?: { xiaohongshu?: boolean };
      } | undefined;
      if (next?.captureEnabled && next.enabledSources?.xiaohongshu !== false) runner.restart();
      else runner.stop();
    });

    window.addEventListener('focus', runner.ensure);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') runner.ensure();
    });
    runner.start();
  },
});
