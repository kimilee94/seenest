import { parseXiaohongshuNote } from '../parsers/xiaohongshu/parser';
import { matchXiaohongshuNoteRoute } from '../parsers/xiaohongshu/route';
import type { CapturedMemoryItem } from '../types/history';
import type { SiteAdapter } from './types';

export const xiaohongshuAdapter: SiteAdapter<CapturedMemoryItem> = {
  source: 'xiaohongshu',
  match(url) {
    return matchXiaohongshuNoteRoute(url.href) !== null;
  },
  getRouteKey(url) {
    return matchXiaohongshuNoteRoute(url.href)?.noteId ?? null;
  },
  capture({ document, url }) {
    // CaptureRunner 已等待页面稳定；同一次详情访问只会进入这里一次。
    return parseXiaohongshuNote(document, url.href);
  },
};
