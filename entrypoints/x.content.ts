import { parseXDetail } from '../src/parsers/x/parser';
import { matchXDetailRoute } from '../src/parsers/x/route';
import { getSettings } from '../src/storage/settings';
import type { SeenestMessage } from '../src/types/messages';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  main() {
    const getCurrentRouteKey = () => {
      const route = matchXDetailRoute(location.href);
      return route ? `${route.kind}:${route.id}` : '';
    };

    let currentRouteKey = getCurrentRouteKey();
    let capturedKey = '';
    let captureTimer: number | undefined;
    let sessionTimer: number | undefined;
    let routeObserver: MutationObserver | undefined;
    let sessionVersion = 0;

    const stopCaptureSession = () => {
      sessionVersion += 1;
      routeObserver?.disconnect();
      routeObserver = undefined;
      if (captureTimer !== undefined) window.clearTimeout(captureTimer);
      if (sessionTimer !== undefined) window.clearTimeout(sessionTimer);
      captureTimer = undefined;
      sessionTimer = undefined;
    };

    const attemptCapture = async (version: number): Promise<boolean> => {
      captureTimer = undefined;
      if (version !== sessionVersion) return false;
      const route = matchXDetailRoute(location.href);
      if (!route) return false;

      const settings = await getSettings();
      if (version !== sessionVersion || !settings.captureEnabled) return false;

      const key = `${route.kind}:${route.id}`;
      if (capturedKey === key) {
        stopCaptureSession();
        return true;
      }

      const record = parseXDetail(document, location.href);
      if (!record) return false;

      const message: SeenestMessage = { type: 'SEENEST_RECORD', payload: record };
      await browser.runtime.sendMessage(message);
      if (version !== sessionVersion) return false;
      capturedKey = key;
      stopCaptureSession();
      return true;
    };

    const scheduleCapture = (version: number, delay = 350) => {
      if (version !== sessionVersion) return;
      if (captureTimer !== undefined) window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(() => void attemptCapture(version), delay);
    };

    const startCaptureSession = async () => {
      stopCaptureSession();
      const version = sessionVersion;
      const route = matchXDetailRoute(location.href);
      if (!route) return;

      const settings = await getSettings();
      if (version !== sessionVersion || !settings.captureEnabled) return;

      if (await attemptCapture(version)) return;
      if (version !== sessionVersion) return;

      routeObserver = new MutationObserver(() => scheduleCapture(version));
      routeObserver.observe(document.documentElement, { childList: true, subtree: true });
      sessionTimer = window.setTimeout(stopCaptureSession, 15_000);
      scheduleCapture(version, 500);
    };

    window.setInterval(() => {
      const nextRouteKey = getCurrentRouteKey();
      if (nextRouteKey !== currentRouteKey) {
        currentRouteKey = nextRouteKey;
        capturedKey = '';
        void startCaptureSession();
      }
    }, 1_000);

    browser.storage.onChanged.addListener((changes, area) => {
      const nextSettings = changes.seenestSettings?.newValue as { captureEnabled?: boolean } | undefined;
      if (area !== 'local' || nextSettings?.captureEnabled === undefined) return;
      if (nextSettings.captureEnabled) {
        capturedKey = '';
        void startCaptureSession();
      } else {
        stopCaptureSession();
      }
    });

    void startCaptureSession();
  },
});
