import type { CapturedMemoryItem } from '../../types/history';
import { matchXiaohongshuNoteRoute } from './route';

const PARSER_VERSION = 1;
const CONTENT_LIMIT = 2_000;
const FALLBACK_TITLE_LIMIT = 40;

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function firstText(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const text = cleanText(root.querySelector(selector)?.textContent);
    if (text) return text;
  }
  return '';
}

function firstAttribute(root: ParentNode, selectors: string[], attributes: string[]): string {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (!element) continue;
    for (const attribute of attributes) {
      const value = cleanText(element.getAttribute(attribute));
      if (value) return value;
    }
  }
  return '';
}

function persistentUrl(value: string, base = 'https://www.xiaohongshu.com'): string {
  if (!value || value.startsWith('blob:') || value.startsWith('data:')) return '';
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function canonicalProfileUrl(value: string): string {
  const absolute = persistentUrl(value);
  if (!absolute) return '';
  const url = new URL(absolute);
  return /^\/user\/profile\/[^/]+/.test(url.pathname) ? `${url.origin}${url.pathname}` : '';
}

/** 兼容 1,234、1.2万、3K 等页面缩写；不可确认时保留 null。 */
export function parseXiaohongshuCount(value: string | null | undefined): number | null {
  const normalized = cleanText(value).replace(/,/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(万|亿|千|[KMB])?/i);
  if (!match) return null;
  const unit = (match[2] ?? '').toLowerCase();
  const multiplier = unit === '千' || unit === 'k' ? 1_000
    : unit === '万' ? 10_000
      : unit === 'm' ? 1_000_000
        : unit === '亿' ? 100_000_000
          : unit === 'b' ? 1_000_000_000 : 1;
  const valueNumber = Number(match[1]);
  return Number.isFinite(valueNumber) ? Math.round(valueNumber * multiplier) : null;
}

function readMetric(root: ParentNode, selectors: string[], emptyValue: number | null = null): number | null {
  let found = false;
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (!element) continue;
    found = true;
    for (const value of [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]) {
      const count = parseXiaohongshuCount(value);
      if (count !== null) return count;
    }
  }
  return found ? emptyValue : null;
}

function parsePublishedAt(root: ParentNode): string | null {
  const element = root.querySelector<HTMLElement>([
    'time[datetime]', '.date', '.publish-time', '[class*="publish-time"]', '[class*="date"]',
  ].join(', '));
  if (!element) return null;
  const raw = cleanText(element.getAttribute('datetime') || element.dataset.time || element.textContent);
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) {
    const timestamp = Number(raw) * (raw.length === 10 ? 1_000 : 1);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  const exact = raw.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (exact) {
    const date = new Date(Number(exact[1]), Number(exact[2]) - 1, Number(exact[3]));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  // “几分钟前 / 几小时前 / 几天前”等相对时间会不断变化，不能作为永久记录写入。
  return null;
}

function parseMetaPublishedAt(document: Document): string | null {
  const raw = cleanText(firstAttribute(document, [
    'meta[property="article:published_time"]', 'meta[itemprop="datePublished"]',
  ], ['content']));
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isDefaultXiaohongshuImage(value: string): boolean {
  return /picasso-static\.xiaohongshu\.com\/fe-platform|fe-video-qc\.xhscdn\.com\/fe-platform|favicon|logo/i.test(value);
}

function readImageUrl(image: HTMLImageElement): string {
  return persistentUrl(image.currentSrc || image.getAttribute('src') || image.getAttribute('data-src') || '');
}

function isContentImage(image: HTMLImageElement): boolean {
  const src = readImageUrl(image);
  return Boolean(src)
    && !isDefaultXiaohongshuImage(src)
    && !/avatar|profile|emoji|icon|logo/i.test(`${image.className} ${src}`);
}

function readPreview(root: ParentNode, isVideo: boolean, document: Document): string {
  if (isVideo) {
    const poster = persistentUrl(root.querySelector<HTMLVideoElement>('video')?.poster ?? '');
    if (poster && !isDefaultXiaohongshuImage(poster)) return poster;
  }
  const selectors = [
    '.swiper-slide:not(.swiper-slide-duplicate) img',
    '[class*="note-slider"] img',
    '[class*="carousel"] img',
    '[class*="player"] img',
    '.note-content img',
  ];
  for (const selector of selectors) {
    const image = Array.from(root.querySelectorAll<HTMLImageElement>(selector)).find(isContentImage);
    if (image) return readImageUrl(image);
  }
  const declaredUrl = cleanText(document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content);
  const route = matchXiaohongshuNoteRoute(declaredUrl);
  if (!route) return '';
  // 小红书通常先写入站点默认图，再追加真实笔记图；只选择非品牌占位图。
  const declaredImages = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"]'))
    .map((meta) => persistentUrl(meta.content))
    .filter((url) => url && !isDefaultXiaohongshuImage(url));
  return declaredImages[0] ?? '';
}

function findDetailRoot(document: Document, noteId: string): HTMLElement | null {
  // 分次查找才能真正体现优先级；CSS 选择器列表只按文档顺序返回首个节点。
  for (const selector of [
    '#noteContainer',
    '.note-detail-mask .note-container', '.note-detail-mask',
    `[data-note-id="${noteId}"] .note-container`, `[data-note-id="${noteId}"]`,
    '.note-container', '[class*="note-detail"]',
  ]) {
    const root = document.querySelector<HTMLElement>(selector);
    if (root) return root;
  }
  return null;
}

/** 从用户真正打开的小红书详情页提取公开内容；关键字段未稳定渲染时返回 null。 */
export function parseXiaohongshuNote(document: Document, href: string): CapturedMemoryItem | null {
  const route = matchXiaohongshuNoteRoute(href);
  if (!route) return null;

  const root = findDetailRoot(document, route.noteId);
  if (!root) return null;

  const metaUrl = cleanText(document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content);
  const metaMatches = !metaUrl || matchXiaohongshuNoteRoute(metaUrl)?.noteId === route.noteId;
  const rawContent = cleanText(firstText(root, [
    '.note-content .desc', '#detail-desc', '.desc', '[class*="note-content"] [class*="desc"]',
  ]) || (metaMatches ? document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content : ''));
  const explicitTitle = cleanText(firstText(root, [
    '.note-content .title', '#detail-title', '.title', '[class*="note-content"] h1',
  ]) || (metaMatches ? document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content : ''))
    .replace(/\s*[-|]\s*小红书\s*$/i, '');
  const title = (explicitTitle || rawContent.slice(0, FALLBACK_TITLE_LIMIT)).slice(0, 200);
  const contentText = (rawContent || explicitTitle).slice(0, CONTENT_LIMIT);

  const profileHref = firstAttribute(root, [
    '.author-container a[href*="/user/profile/"]', 'a.author[href*="/user/profile/"]',
    'a[href*="/user/profile/"]',
  ], ['href']);
  const authorName = firstText(root, [
    '.author-container .username', '.author-wrapper .username', '.user-name',
    'a[href*="/user/profile/"] [class*="name"]',
  ]);
  if (!title || !contentText || !authorName) return null;

  const avatarUrl = persistentUrl(firstAttribute(root, [
    '.author-container img', '.author-wrapper img', 'a[href*="/user/profile/"] img',
  ], ['src', 'data-src']));
  const isVideo = Boolean(root.querySelector('video, [class*="video-player"], [class*="player-container"]'))
    || /video/i.test(document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content ?? '');
  const previewUrl = readPreview(root, isVideo, document);

  return {
    id: `xiaohongshu:${route.noteId}`,
    source: 'xiaohongshu',
    contentType: isVideo ? 'video' : 'post',
    // 展示与回跳使用包含 xsec 上下文的原始详情地址；canonicalUrl 继续负责 noteId 去重。
    url: route.accessUrl,
    canonicalUrl: route.canonicalUrl,
    postId: route.noteId,
    title,
    contentText,
    authorName,
    authorHandle: '',
    authorProfileUrl: canonicalProfileUrl(profileHref),
    authorAvatarUrl: avatarUrl,
    replyCount: readMetric(root, ['.engage-bar-style .chat-wrapper', '.chat-wrapper', '[class*="comment"] [class*="count"]', '[aria-label*="评论"]'], 0),
    shareCount: readMetric(root, ['.share-wrapper', '[class*="share"] [class*="count"]', '[aria-label*="分享"]']),
    bookmarkCount: readMetric(root, ['.engage-bar-style .collect-wrapper', '.collect-wrapper', '[class*="collect"] [class*="count"]', '[aria-label*="收藏"]'], 0),
    likeCount: readMetric(root, ['.engage-bar-style .like-wrapper', '.like-wrapper', '[class*="like"] [class*="count"]', '[aria-label*="点赞"]', '[aria-label*="喜欢"]'], 0),
    mediaType: previewUrl ? (isVideo ? 'video' : 'image') : undefined,
    mediaPreviewUrl: previewUrl || undefined,
    publishedAt: parsePublishedAt(root) ?? (metaMatches ? parseMetaPublishedAt(document) : null),
    parserVersion: PARSER_VERSION,
  };
}
