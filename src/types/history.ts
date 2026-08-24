export type ContentType = 'post' | 'article';

export interface HistoryRecord {
  id: string;
  source: 'x';
  contentType: ContentType;
  url: string;
  canonicalUrl: string;
  postId: string;
  title: string;
  contentText: string;
  authorName: string;
  authorHandle: string;
  authorAvatarUrl: string;
  publishedAt: string | null;
  firstVisitedAt: string;
  lastVisitedAt: string;
  visitCount: number;
  parserVersion: number;
}

export interface CapturedHistoryRecord extends Omit<HistoryRecord, 'firstVisitedAt' | 'lastVisitedAt' | 'visitCount'> {
  visitedAt: string;
}

export interface ExportPayload {
  app: 'Seenest';
  version: 1;
  exportedAt: string;
  records: HistoryRecord[];
}
