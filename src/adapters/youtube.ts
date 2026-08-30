import { parseYoutubeMemory } from '../parsers/youtube/parser';
import { matchYoutubeVideoRoute } from '../parsers/youtube/route';
import type { CapturedMemoryItem } from '../types/history';
import type { SiteAdapter } from './types';

export const youtubeAdapter: SiteAdapter<CapturedMemoryItem> = {
  source: 'youtube',
  match(url) {
    return matchYoutubeVideoRoute(url.href) !== null;
  },
  getRouteKey(url) {
    return matchYoutubeVideoRoute(url.href)?.videoId ?? null;
  },
  capture({ document, url }) {
    return parseYoutubeMemory(document, url.href);
  },
};
