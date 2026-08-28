import type { CapturedHistoryRecord } from './history';

export type SeenestMessage =
  | { type: 'SEENEST_RECORD'; payload: CapturedHistoryRecord }
  | { type: 'SEENEST_BILIBILI_CAPTURE'; payload: { bvid: string; url: string; visitedAt: string } }
  | { type: 'SEENEST_ACTIVE_TIME'; payload: { recordId: string; sessionId: string; sequence: number; durationMs: number; measuredAt: string } }
  | { type: 'SEENEST_ACTIVITY_STATE' }
  | { type: 'SEENEST_SYNC_SOURCE_REGISTRATION' }
  | { type: 'SEENEST_OPEN_DASHBOARD' }
  | { type: 'SEENEST_CAPTURE_STATE' };
