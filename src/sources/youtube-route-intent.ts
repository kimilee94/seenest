import { matchYoutubeVideoRoute } from '../parsers/youtube/route';

export interface YoutubeRouteIntentTracker {
  sync(href: string, now?: number): boolean;
  markInteraction(href: string, now?: number): void;
  canCapture(href: string, now?: number): boolean;
}

/**
 * 初始页面视为用户主动打开；后续 videoId 变化只有紧邻可信交互时才允许采集。
 * 这会过滤播放列表连播产生的纯自动路由，同时允许用户接管自动进入的视频。
 */
export function createYoutubeRouteIntentTracker(
  initialHref: string,
  interactionWindowMs = 3_000,
): YoutubeRouteIntentTracker {
  let currentRouteKey = matchYoutubeVideoRoute(initialHref)?.videoId ?? '';
  let currentRouteEligible = Boolean(currentRouteKey);
  let lastTrustedInteractionAt = 0;

  const sync = (href: string, now = Date.now()) => {
    const nextRouteKey = matchYoutubeVideoRoute(href)?.videoId ?? '';
    if (nextRouteKey !== currentRouteKey) {
      currentRouteKey = nextRouteKey;
      currentRouteEligible = Boolean(nextRouteKey)
        && now - lastTrustedInteractionAt <= interactionWindowMs;
    }
    return currentRouteEligible;
  };

  return {
    sync,
    markInteraction(href, now = Date.now()) {
      lastTrustedInteractionAt = now;
      sync(href, now);
      if (currentRouteKey) currentRouteEligible = true;
    },
    canCapture(href, now = Date.now()) {
      return sync(href, now);
    },
  };
}
