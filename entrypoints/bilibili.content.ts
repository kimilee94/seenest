import { matchBilibiliVideoRoute } from '../src/parsers/bilibili/route';
import { createActiveTimeTracker } from '../src/activity/active-time-tracker';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

const CAPTURE_DELAY_MS = 2_000;

export default defineContentScript({
  // 此脚本由后台在用户主动授权 B 站后注册，不写入 manifest 的静态 content_scripts。
  registration: 'runtime',
  runAt: 'document_idle',
  main() {
    const activeTimeTracker = createActiveTimeTracker();
    let currentRouteKey = '';
    let attemptedRouteKey = '';
    let captureTimer: number | undefined;

    const stopTimer = () => {
      if (captureTimer !== undefined) window.clearTimeout(captureTimer);
      captureTimer = undefined;
    };

    /** 等待短暂稳定期后只发送 BVID；后台负责校验来源并读取公开详情数据。 */
    const scheduleCapture = async () => {
      stopTimer();
      const route = matchBilibiliVideoRoute(location.href);
      if (!route || attemptedRouteKey === route.bvid) return;
      const settings = await getSettings();
      if (!settings.captureEnabled || !settings.enabledSources.bilibili) return;

      captureTimer = window.setTimeout(async () => {
        const latestRoute = matchBilibiliVideoRoute(location.href);
        if (!latestRoute || latestRoute.bvid !== route.bvid) return;
        // 发送前就标记为已尝试；即使请求失败，当前页面也绝不重试。
        attemptedRouteKey = route.bvid;
        const message: SeenestMessage = {
          type: 'SEENEST_BILIBILI_CAPTURE',
          payload: { bvid: route.bvid, url: location.href, visitedAt: new Date().toISOString() },
        };
        try {
          const response = await browser.runtime.sendMessage(message) as { ok?: boolean; recordId?: string } | undefined;
          if (response?.ok && response.recordId) activeTimeTracker.start(response.recordId);
        } catch {
          // 后台不可用时保持已尝试状态，避免恢复后在同一页面突发重试。
        }
      }, CAPTURE_DELAY_MS);
    };

    // B 站同样会在不刷新页面的情况下切换视频，每秒只比较 URL，不扫描播放器 DOM。
    window.setInterval(() => {
      const nextRouteKey = matchBilibiliVideoRoute(location.href)?.bvid ?? '';
      if (nextRouteKey !== currentRouteKey) {
        activeTimeTracker.stop();
        currentRouteKey = nextRouteKey;
        attemptedRouteKey = '';
        void scheduleCapture();
      }
    }, 1_000);

    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.seenestSettings) return;
      const nextSettings = changes.seenestSettings.newValue as { captureEnabled?: boolean; enabledSources?: { bilibili?: boolean } } | undefined;
      if (nextSettings?.captureEnabled && nextSettings.enabledSources?.bilibili !== false) void scheduleCapture();
      else activeTimeTracker.stop();
    });

    currentRouteKey = matchBilibiliVideoRoute(location.href)?.bvid ?? '';
    void scheduleCapture();
  },
});
