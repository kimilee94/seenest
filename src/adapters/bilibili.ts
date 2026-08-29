import { matchBilibiliVideoRoute } from '../parsers/bilibili/route';
import type { SiteAdapter } from './types';

export interface BilibiliCaptureRequest {
  bvid: string;
  url: string;
}

export const bilibiliAdapter: SiteAdapter<BilibiliCaptureRequest> = {
  source: 'bilibili',
  match(url) {
    return ['bilibili.com', 'www.bilibili.com'].includes(url.hostname)
      && matchBilibiliVideoRoute(url.href) !== null;
  },
  getRouteKey(url) {
    return matchBilibiliVideoRoute(url.href)?.bvid ?? null;
  },
  capture({ url }) {
    const route = matchBilibiliVideoRoute(url.href);
    return route ? { bvid: route.bvid, url: url.href } : null;
  },
};
