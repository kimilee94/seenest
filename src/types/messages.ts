import type { CapturedHistoryRecord } from './history';

export type SeenestMessage =
  | { type: 'SEENEST_RECORD'; payload: CapturedHistoryRecord }
  | { type: 'SEENEST_BILIBILI_CAPTURE'; payload: { bvid: string; url: string; visitedAt: string } }
  | { type: 'SEENEST_SYNC_SOURCE_REGISTRATION' }
  | { type: 'SEENEST_OPEN_DASHBOARD' }
  | { type: 'SEENEST_CAPTURE_STATE' };
