import type { CapturedHistoryRecord } from './history';

export type SeenestMessage =
  | { type: 'SEENEST_RECORD'; payload: CapturedHistoryRecord }
  | { type: 'SEENEST_OPEN_DASHBOARD' }
  | { type: 'SEENEST_CAPTURE_STATE' };
