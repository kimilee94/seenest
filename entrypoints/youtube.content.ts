import { createActiveTimeTracker } from '../src/activity/active-time-tracker';
import { createCaptureRunner } from '../src/adapters/capture-runner';
import { youtubeAdapter } from '../src/adapters/youtube';
import { createYoutubeRouteIntentTracker } from '../src/sources/youtube-route-intent';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';
import { installExtensionContextInvalidationGuard } from '../src/utils/extension-context';

const CAPTURE_SETTLE_MS = 8_000;

export default defineContentScript({
  // YouTube 需要用户主动授权；只匹配标准视频详情，其他页面会被 Adapter 拒绝。
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    installExtensionContextInvalidationGuard();
    const routeIntent = createYoutubeRouteIntentTracker(location.href);

    const activeTimeTracker = createActiveTimeTracker();
    const runner = createCaptureRunner({
      adapter: youtubeAdapter,
      settleMs: CAPTURE_SETTLE_MS,
      maxWaitMs: 30_000,
      observeDom: true,
      async isEnabled() {
        const settings = await getSettings();
        return settings.captureEnabled
          && settings.enabledSources.youtube
          && document.visibilityState === 'visible'
          && document.hasFocus()
          && routeIntent.canCapture(location.href);
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
          // 页面关闭或扩展更新时停止本次提交，不循环重试，也不会产生重复 Visit。
        }
      },
    });

    const markTrustedInteraction = () => {
      routeIntent.markInteraction(location.href);
      runner.ensure();
    };
    window.addEventListener('pointerdown', markTrustedInteraction, { passive: true });
    window.addEventListener('keydown', markTrustedInteraction, { passive: true });
    // YouTube 的 SPA 导航事件用于立即响应，CaptureRunner 的低频 URL 检查仍作为兼容兜底。
    window.addEventListener('yt-navigate-finish', () => {
      routeIntent.sync(location.href);
      runner.ensure();
    });
    window.addEventListener('yt-page-data-updated', runner.ensure);

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.seenestSettings) return;
      const next = changes.seenestSettings.newValue as {
        captureEnabled?: boolean;
        enabledSources?: { youtube?: boolean };
      } | undefined;
      if (next?.captureEnabled && next.enabledSources?.youtube !== false) runner.restart();
      else runner.stop();
    });

    window.addEventListener('focus', runner.ensure);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') runner.ensure();
    });
    runner.start();
  },
});
