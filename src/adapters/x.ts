import { parseXDetail } from '../parsers/x/parser';
import { matchXDetailRoute } from '../parsers/x/route';
import type { CapturedMemoryItem } from '../types/history';
import type { SiteAdapter } from './types';

export const xAdapter: SiteAdapter<CapturedMemoryItem> = {
  source: 'x',
  match(url) {
    return ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)
      && matchXDetailRoute(url.href) !== null;
  },
  getRouteKey(url) {
    const route = matchXDetailRoute(url.href);
    return route ? `${route.kind}:${route.id}` : null;
  },
  capture({ document, url }) {
    return parseXDetail(document, url.href);
  },
};
