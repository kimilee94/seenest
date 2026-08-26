export type ContentType = 'post' | 'article';
export type HistorySource = 'x' | (string & {});

/** X 详情页公开展示的互动数据；null 表示页面尚未渲染或当前不可见。 */
export interface EngagementMetrics {
  replyCount?: number | null;
  repostCount?: number | null;
  viewCount?: number | null;
  bookmarkCount?: number | null;
  likeCount?: number | null;
}

export interface HistoryRecord extends EngagementMetrics {
  id: string;
  source: HistorySource;
  contentType: ContentType;
  url: string;
  canonicalUrl: string;
  postId: string;
  title: string;
  contentText: string;
  authorName: string;
  authorHandle: string;
  /** 作者公开主页；可选以兼容升级前保存的历史记录和旧版 JSON 备份。 */
  authorProfileUrl?: string;
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
