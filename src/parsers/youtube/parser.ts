import type { CapturedMemoryItem } from '../../types/history';
import { canonicalizeYoutubeVideoUrl, matchYoutubeVideoRoute } from './route';

const PARSER_VERSION = 1;
const DESCRIPTION_LIMIT = 2_000;

interface YoutubePlayerResponse {
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    channelId?: string;
    shortDescription?: string;
    lengthSeconds?: string;
    viewCount?: string;
    thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> };
  };
  microformat?: {
    playerMicroformatRenderer?: {
      publishDate?: string;
      uploadDate?: string;
      ownerProfileUrl?: string;
      thumbnail?: { thumbnails?: Array<{ url?: string; width?: number }> };
    };
  };
}

function compactText(value: string | null | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function firstText(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const value = compactText(root.querySelector(selector)?.textContent);
    if (value) return value;
  }
  return '';
}

function firstAttribute(root: ParentNode, selectors: string[], attribute: string): string {
  for (const selector of selectors) {
    const value = root.querySelector(selector)?.getAttribute(attribute)?.trim();
    if (value) return value;
  }
  return '';
}

function absoluteYoutubeUrl(value: string): string {
  if (!value) return '';
  try {
    return new URL(value, 'https://www.youtube.com').href;
  } catch {
    return '';
  }
}

/** 读取页面源码中的 JSON 赋值，不执行页面脚本，也不访问任何 YouTube 接口。 */
function readAssignedJson(document: Document, variableName: string): unknown {
  for (const script of document.scripts) {
    const source = script.textContent ?? '';
    const marker = source.indexOf(variableName);
    if (marker < 0) continue;
    const equals = source.indexOf('=', marker + variableName.length);
    const start = equals >= 0 ? source.indexOf('{', equals + 1) : -1;
    if (start < 0) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const char = source[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

/** 支持 1,234、1.2K、3.4万 等页面本地化数字；无法确认时返回 null 而不是伪造 0。 */
export function parseYoutubeCount(value: string | null | undefined): number | null {
  const normalized = compactText(value).replace(/,/g, '');
  const matches = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*([KMB万億亿千]?)/gi)];
  if (!matches.length) return null;
  const multipliers: Record<string, number> = {
    k: 1_000, 千: 1_000, m: 1_000_000, 万: 10_000, b: 1_000_000_000, 亿: 100_000_000, 億: 100_000_000,
  };
  const values = matches.map((match) => {
    const base = Number(match[1]);
    const multiplier = multipliers[(match[2] ?? '').toLowerCase()] ?? 1;
    return Number.isFinite(base) ? Math.round(base * multiplier) : 0;
  }).filter((count) => count >= 0);
  return values.length ? Math.max(...values) : null;
}

function countFromElements(root: ParentNode, selectors: string[]): number | null {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (!element) continue;
    for (const value of [element.getAttribute('title'), element.getAttribute('aria-label'), element.textContent]) {
      const count = parseYoutubeCount(value);
      if (count !== null) return count;
    }
  }
  return null;
}

function countFromStructuredNode(value: unknown): number | null {
  const textParts: string[] = [];
  const visit = (node: unknown, depth: number, collectPrimitive = false) => {
    if (depth > 8 || node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') {
      if (collectPrimitive) textParts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1, collectPrimitive);
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      // 可以穿过 YouTube 经常变化的视图模型层级，但只收集面向用户的文字字段，
      // 避免把 videoId、trackingParams 等内部数字误当成互动计数。
      const isTextField = /^(simpleText|text|label|title|content|tooltip)$/i.test(key);
      visit(child, depth + 1, collectPrimitive || isTextField);
    }
  };
  visit(value, 0);
  return parseYoutubeCount(textParts.join(' '));
}

function findStructuredCount(root: unknown, keys: Set<string>, depth = 0): number | null {
  if (depth > 20 || root === null || root === undefined) return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const count = findStructuredCount(item, keys, depth + 1);
      if (count !== null) return count;
    }
    return null;
  }
  if (typeof root !== 'object') return null;
  for (const [key, value] of Object.entries(root)) {
    if (keys.has(key)) {
      const count = countFromStructuredNode(value);
      if (count !== null) return count;
    }
    const nested = findStructuredCount(value, keys, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

function parseIsoDuration(value: string): number | null {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const total = hours * 3_600 + minutes * 60 + seconds;
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

/** 将当前标准视频页面转换为通用 Memory；关键标题尚未渲染时返回 null 等待下一次 DOM 变化。 */
export function parseYoutubeMemory(document: Document, href: string): CapturedMemoryItem | null {
  const route = matchYoutubeVideoRoute(href);
  if (!route) return null;

  const root = document;
  const embedded = readAssignedJson(document, 'ytInitialPlayerResponse') as YoutubePlayerResponse | null;
  // SPA 切换时页面源码可能仍保留上一条视频的数据，ID 不一致时禁止作为回退。
  const player = embedded?.videoDetails?.videoId === route.videoId ? embedded : null;
  const initialData = player ? readAssignedJson(document, 'ytInitialData') : null;
  const details = player?.videoDetails;
  const microformat = player?.microformat?.playerMicroformatRenderer;

  const domTitle = firstText(root, ['ytd-watch-metadata h1 yt-formatted-string', '#title h1 yt-formatted-string']);
  const metaTitle = firstAttribute(document, ['meta[property="og:title"]', 'meta[name="title"]'], 'content');
  const title = compactText(domTitle || details?.title || metaTitle).replace(/\s+-\s+YouTube$/i, '');
  if (!title) return null;

  const profileHref = firstAttribute(root, [
    'ytd-video-owner-renderer ytd-channel-name a', '#owner ytd-channel-name a',
    '#channel-name a', 'a.yt-simple-endpoint[href^="/@"]', 'a[href^="/channel/"]',
  ], 'href') || microformat?.ownerProfileUrl || (details?.channelId ? `/channel/${details.channelId}` : '');
  const authorProfileUrl = absoluteYoutubeUrl(profileHref);
  const profilePath = authorProfileUrl ? new URL(authorProfileUrl).pathname : '';
  const handle = decodeURIComponent(profilePath.match(/^\/@([^/]+)/)?.[1] ?? '');
  // 匹配当前视频 ID 的 player data 是最稳定的频道名称来源。YouTube 的
  // ytd-channel-name 父容器还包含同名 tooltip，读取整个 textContent 会把名称拼接两次。
  const authorName = compactText(details?.author) || firstText(root, [
    'ytd-video-owner-renderer #channel-name #text a',
    '#owner #channel-name #text a',
    'ytd-video-owner-renderer ytd-channel-name a',
    '#owner ytd-channel-name a',
    '#channel-name a.yt-simple-endpoint',
  ]) || 'YouTube';
  const avatarUrl = firstAttribute(root, [
    'ytd-video-owner-renderer #avatar img', '#owner #avatar img',
    '#channel-info img',
  ], 'src');

  const description = firstText(root, [
    '#description-inline-expander yt-attributed-string', '#description-inline-expander', '#description yt-attributed-string',
  ])
    || compactText(details?.shortDescription)
    || title;
  const canonicalUrl = canonicalizeYoutubeVideoUrl(route);

  const thumbnailCandidates = [
    firstAttribute(document, ['meta[property="og:image"]'], 'content'),
    firstAttribute(document, ['link[itemprop="thumbnailUrl"]'], 'href'),
    details?.thumbnail?.thumbnails?.at(-1)?.url,
    microformat?.thumbnail?.thumbnails?.at(-1)?.url,
    `https://i.ytimg.com/vi/${route.videoId}/hqdefault.jpg`,
  ];
  const coverUrl = thumbnailCandidates.find((value) => value && /^https:\/\//i.test(value)) ?? '';

  const metaDuration = firstAttribute(document, ['meta[itemprop="duration"]'], 'content');
  const videoDuration = Number((root.querySelector('video') as HTMLVideoElement | null)?.duration);
  const durationSeconds = Number.isFinite(videoDuration) && videoDuration > 0
    ? Math.round(videoDuration)
    : parseIsoDuration(metaDuration) ?? parseYoutubeCount(details?.lengthSeconds);
  const publishedAt = isoDate(
    firstAttribute(document, ['meta[itemprop="datePublished"]', 'meta[itemprop="uploadDate"]'], 'content')
      || microformat?.publishDate
      || microformat?.uploadDate,
  );

  const viewCount = parseYoutubeCount(details?.viewCount)
    ?? parseYoutubeCount(firstAttribute(document, ['meta[itemprop="interactionCount"]'], 'content'))
    ?? countFromElements(root, ['ytd-watch-info-text #info', '#view-count', '.view-count']);
  const likeCount = countFromElements(root, [
    'like-button-view-model button', '#segmented-like-button button',
    'ytd-like-button-renderer button', '#like-button button',
  ]) ?? findStructuredCount(initialData, new Set(['likeButtonViewModel', 'likeButton']));
  const replyCount = countFromElements(root, [
    'ytd-comments-header-renderer #count', '#comments #count yt-formatted-string',
    '#comments-button button', 'button[aria-label*="comment" i]', 'button[aria-label*="评论"]',
  ]) ?? findStructuredCount(initialData, new Set(['commentCount', 'commentsEntryPointHeaderRenderer']));

  return {
    id: `youtube:video:${route.videoId}`,
    source: 'youtube',
    contentType: 'video',
    url: canonicalUrl,
    canonicalUrl,
    postId: route.videoId,
    title,
    contentText: description.slice(0, DESCRIPTION_LIMIT),
    authorName,
    authorHandle: handle ? `@${handle}` : '',
    authorProfileUrl,
    authorAvatarUrl: avatarUrl,
    replyCount,
    viewCount,
    likeCount,
    durationSeconds,
    mediaType: coverUrl ? 'video' : undefined,
    mediaPreviewUrl: coverUrl || undefined,
    publishedAt,
    parserVersion: PARSER_VERSION,
    metadata: { channelId: details?.channelId ?? null },
  };
}
