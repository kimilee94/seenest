import { parseXDetail } from '../src/parsers/x/parser';
import { matchXDetailRoute } from '../src/parsers/x/route';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

// X 的正文通常先出现，图片、视频封面和互动数据会随后异步挂载；至少等待 3 秒再落库。
const CONTENT_SETTLE_PERIOD_MS = 3_000;

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  main() {
    // X 使用单页应用路由，同一个页面会在不刷新的情况下切换帖子，因此用路由类型和内容 ID 识别当前详情页。
    const getCurrentRouteKey = () => {
      const route = matchXDetailRoute(location.href);
      return route ? `${route.kind}:${route.id}` : '';
    };

    // 每次进入新的详情页只创建一个短时采集会话；采集成功、超时或离开页面后立即停止 DOM 监听。
    let currentRouteKey = getCurrentRouteKey();
    let capturedKey = '';
    let captureTimer: number | undefined;
    let sessionTimer: number | undefined;
    let routeObserver: MutationObserver | undefined;
    let sessionVersion = 0;
    let sessionStartedAt = 0;

    // sessionVersion 会让上一条路由中尚未完成的异步任务自动失效，避免串页写入错误内容。
    const stopCaptureSession = () => {
      sessionVersion += 1;
      routeObserver?.disconnect();
      routeObserver = undefined;
      if (captureTimer !== undefined) window.clearTimeout(captureTimer);
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer);
      captureTimer = undefined;
      sessionTimer = undefined;
    };

    // 在正文、作者等必要字段已渲染完成后解析页面，并把结果交给后台统一去重入库。
    const attemptCapture = async (version: number): Promise<boolean> => {
      captureTimer = undefined;
      if (version !== sessionVersion) return false;
      const route = matchXDetailRoute(location.href);
      if (!route) return false;

      const settings = await getSettings();
      if (version !== sessionVersion || !settings.captureEnabled || !settings.enabledSources.x) return false;

      const key = `${route.kind}:${route.id}`;
      if (capturedKey === key) {
        stopCaptureSession();
        return true;
      }

      const record = parseXDetail(document, location.href);
      if (!record) return false;

      // 无论互动数据是否已出现，都给媒体节点一次固定渲染窗口，避免正文刚出现就过早结束监听。
      const remainingGraceTime = CONTENT_SETTLE_PERIOD_MS - (Date.now() - sessionStartedAt);
      if (remainingGraceTime > 0) {
        scheduleCapture(version, remainingGraceTime);
        return false;
      }

      const message: SeenestMessage = { type: 'SEENEST_RECORD', payload: record };
      await browser.runtime.sendMessage(message);
      if (version !== sessionVersion) return false;
      capturedKey = key;
      stopCaptureSession();
      return true;
    };

    // DOM 可能连续更新多次，通过防抖只在页面相对稳定时执行一次解析。
    const scheduleCapture = (version: number, delay = 350) => {
      if (version !== sessionVersion) return;
      if (captureTimer !== undefined) window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(() => void attemptCapture(version), delay);
    };

    // 详情页最多监听 15 秒；如果内容已经存在则立即采集并结束，不让观察器长期占用资源。
    const startCaptureSession = async () => {
      stopCaptureSession();
      const version = sessionVersion;
      const route = matchXDetailRoute(location.href);
      if (!route) return;
      sessionStartedAt = Date.now();

      const settings = await getSettings();
      if (version !== sessionVersion || !settings.captureEnabled || !settings.enabledSources.x) return;

      if (await attemptCapture(version)) return;
      if (version !== sessionVersion) return;

      routeObserver = new MutationObserver(() => scheduleCapture(version));
      routeObserver.observe(document.documentElement, { childList: true, subtree: true });
      sessionTimer = window.setTimeout(stopCaptureSession, 15_000);
      scheduleCapture(version, 500);
    };

    // 这里只做每秒一次的轻量 URL 检查，用于发现 X 的 SPA 路由变化，不持续扫描页面 DOM。
    window.setInterval(() => {
      const nextRouteKey = getCurrentRouteKey();
      if (nextRouteKey !== currentRouteKey) {
        currentRouteKey = nextRouteKey;
        capturedKey = '';
        void startCaptureSession();
      }
    }, 1_000);

    // 用户在插件界面切换记录开关时，当前页面无需刷新即可立即启动或停止采集。
    browser.storage.onChanged.addListener((changes, area) => {
      const nextSettings = changes.seenestSettings?.newValue as { captureEnabled?: boolean; enabledSources?: { x?: boolean } } | undefined;
      if (area !== 'local' || !nextSettings) return;
      if (nextSettings.captureEnabled && nextSettings.enabledSources?.x !== false) {
        capturedKey = '';
        void startCaptureSession();
      } else {
        stopCaptureSession();
      }
    });

    void startCaptureSession();
  },
});
