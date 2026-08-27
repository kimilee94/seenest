import type { CapturedHistoryRecord } from '../../types/history';
import { canonicalizeBilibiliVideoUrl, isValidBvid } from './route';

const PARSER_VERSION = 1;

export interface BilibiliViewData {
  bvid: string;
  cid?: number;
  title: string;
  desc?: string;
  pic?: string;
  pubdate?: number;
  duration?: number;
  owner?: { mid?: number; name?: string; face?: string };
  stat?: {
    reply?: number;
    favorite?: number;
    share?: number;
    like?: number;
    view?: number;
  };
}

export interface BilibiliViewResponse {
  code: number;
  message?: string;
  data?: BilibiliViewData;
}

/** B 站部分公开图片仍返回 http，统一升级为 https，避免扩展页面混合内容拦截。 */
function secureUrl(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  return value.replace(/^http:\/\//i, 'https://');
}

/** 将公开详情接口转换为 Seenest 通用记录；缺少标题或合法 BVID 时拒绝保存残缺数据。 */
export function parseBilibiliViewResponse(
  response: BilibiliViewResponse,
  visitedAt = new Date(),
): CapturedHistoryRecord | null {
  const data = response.code === 0 ? response.data : undefined;
  if (!data || !isValidBvid(data.bvid) || !data.title?.trim()) return null;

  const canonicalUrl = canonicalizeBilibiliVideoUrl(data.bvid);
  const ownerId = typeof data.owner?.mid === 'number' ? String(data.owner.mid) : '';
  const coverUrl = secureUrl(data.pic);
  const publishedAt = typeof data.pubdate === 'number' && data.pubdate > 0
    ? new Date(data.pubdate * 1_000).toISOString()
    : null;

  return {
    id: `bilibili:video:${data.bvid}`,
    source: 'bilibili',
    contentType: 'video',
    url: canonicalUrl,
    canonicalUrl,
    postId: data.bvid,
    title: data.title.trim(),
    contentText: data.desc?.trim() || data.title.trim(),
    authorName: data.owner?.name?.trim() || '未知 UP 主',
    authorHandle: ownerId ? `UID ${ownerId}` : '',
    authorProfileUrl: ownerId ? `https://space.bilibili.com/${ownerId}` : '',
    authorAvatarUrl: secureUrl(data.owner?.face),
    replyCount: data.stat?.reply ?? null,
    shareCount: data.stat?.share ?? null,
    viewCount: data.stat?.view ?? null,
    bookmarkCount: data.stat?.favorite ?? null,
    likeCount: data.stat?.like ?? null,
    durationSeconds: data.duration ?? null,
    mediaType: coverUrl ? 'video' : undefined,
    mediaPreviewUrl: coverUrl || undefined,
    publishedAt,
    visitedAt: visitedAt.toISOString(),
    parserVersion: PARSER_VERSION,
  };
}
