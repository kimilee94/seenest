import type { CapturedMemoryItem, CapturedVisit } from './history';

export type SeenestMessage =
  | { type: 'SEENEST_RECORD'; payload: { memory: CapturedMemoryItem; visit: CapturedVisit } }
  | { type: 'SEENEST_BILIBILI_CAPTURE'; payload: { bvid: string; url: string; visit: CapturedVisit } }
  | { type: 'SEENEST_ACTIVE_TIME'; payload: { memoryId: string; visitId: string; trackerSessionId: string; sequence: number; durationMs: number; measuredAt: string } }
  | { type: 'SEENEST_VISIT_END'; payload: { memoryId: string; visitId: string; endedAt: string } }
  | { type: 'SEENEST_ACTIVITY_STATE' }
  | { type: 'SEENEST_SYNC_SOURCE_REGISTRATION' }
  | { type: 'SEENEST_OPEN_DASHBOARD' }
  | { type: 'SEENEST_CAPTURE_STATE' };
