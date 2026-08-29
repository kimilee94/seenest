export type ContentType = 'post' | 'article' | 'video' | 'repository' | 'issue';
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

/**
 * Seenest 保存的一份内容记忆。同一个 canonical 内容始终只保留一条，
 * 用户每次进入页面的行为由 VisitRecord 单独记录。
 */
export interface MemoryItem extends EngagementMetrics {
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
  firstSeenAt: string;
  lastSeenAt: string;
  visitCount: number;
  /** 页面处于可见、聚焦且用户未空闲状态时累计的近似活跃停留时间。 */
  activeDurationMs?: number;
  /** Seenest 首次开始为该内容统计活跃停留时间的时间。 */
  activeMeasuredFrom?: string;
  /** 最近一次成功写入活跃停留增量的时间。 */
  lastActiveAt?: string;
  parserVersion: number;
  /** 平台专属的扩展字段；核心列表不依赖这里的具体结构。 */
  metadata?: Record<string, unknown>;
}

/** Adapter 从页面或平台数据源提取出的内容，不包含任何访问行为字段。 */
export type CapturedMemoryItem = Omit<MemoryItem,
  'firstSeenAt' | 'lastSeenAt' | 'visitCount' | 'activeDurationMs' | 'activeMeasuredFrom' | 'lastActiveAt'>;

/** 兼容现有 UI 与外部导入代码；新代码应优先使用 MemoryItem。 */
export type HistoryRecord = MemoryItem;
export type CapturedHistoryRecord = CapturedMemoryItem;

export interface VisitRecord {
  id: string;
  memoryId: string;
  source: HistorySource;
  startedAt: string;
  endedAt: string;
  activeDurationMs: number;
  lastActiveAt?: string;
  referrer?: string;
  /** 浏览器标签 ID 仅用于本机诊断和未来会话归组，不作为长期稳定标识。 */
  tabId?: number;
}

export interface CapturedVisit {
  id: string;
  startedAt: string;
  referrer?: string;
}

export interface ExportPayload {
  app: 'Seenest';
  version: 2;
  exportedAt: string;
  memories: MemoryItem[];
  visits: VisitRecord[];
}

/** v0.1.x 备份格式；导入时会转换成 MemoryItem，但不会伪造历史 Visit。 */
export interface LegacyExportPayload {
  app: 'Seenest';
  version: 1;
  exportedAt: string;
  records: Array<Partial<MemoryItem> & {
    id: string;
    firstVisitedAt?: string;
    lastVisitedAt?: string;
  }>;
}
