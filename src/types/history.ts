export type ContentType = 'post' | 'article' | 'video';
export type HistorySource = 'x' | (string & {});
export type MediaType = 'image' | 'video';

/** X 详情页公开展示的互动数据；null 表示页面尚未渲染或当前不可见。 */
export interface EngagementMetrics {
  replyCount?: number | null;
  repostCount?: number | null;
  shareCount?: number | null;
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
  /** 正文中的首个媒体类型；缺失表示当前页面没有解析到可展示媒体。 */
  mediaType?: MediaType;
  /** 可持久访问的原图或视频地址；不会保存 X 页面临时生成的 blob: 视频地址。 */
  mediaUrl?: string;
  /** 视频封面或其他媒体预览图，用于列表轻量展示。 */
  mediaPreviewUrl?: string;
  /** 图片的公开替代文本，便于无障碍展示和备份迁移。 */
  mediaAlt?: string;
  /** 视频总时长（秒）；非视频内容或平台未提供时为空。 */
  durationSeconds?: number | null;
  publishedAt: string | null;
  firstVisitedAt: string;
  lastVisitedAt: string;
  visitCount: number;
  /** 页面处于可见、聚焦且用户未空闲状态时累计的近似活跃停留时间。 */
  activeDurationMs?: number;
  /** Seenest 首次开始为该内容统计活跃停留时间的时间。 */
  activeMeasuredFrom?: string;
  /** 最近一次成功写入活跃停留增量的时间。 */
  lastActiveAt?: string;
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
