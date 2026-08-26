import type { CapturedHistoryRecord, ContentType, EngagementMetrics } from '../../types/history';
import { canonicalizeXUrl, matchXDetailRoute } from './route';

const PARSER_VERSION = 6;
const SPACE_PATTERN = /\s+/g;
// X 的长文章在不同入口下可能使用不同容器，集中维护选择器便于后续适配页面改版。
const ARTICLE_VIEW_SELECTOR = [
  '[data-testid="twitterArticleReadView"]',
  '[data-testid="article-cover"]',
  '[data-testid="article-content"]',
  '.x-article-body',
].join(', ');
const ARTICLE_TITLE_SELECTOR = [
  // 登录态 X 当前使用的真实长文章标题标记（2026-08 实测）。
  '[data-testid="twitter-article-title"]',
  '[data-testid="twitterArticleTitle"]',
  '[data-testid="article-title"]',
  '[data-testid="ArticleTitle"]',
].join(', ');
const ARTICLE_BODY_SELECTOR = [
  // 登录态长文章的正文区域；标题和互动栏都位于这个容器之外。
  '[data-testid="twitterArticleRichTextView"]',
  '.x-article-body',
  '[data-testid="article-content"]',
].join(', ');

/** 合并连续空白并清理首尾字符，统一来自不同 DOM 节点的文本格式。 */
function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(SPACE_PATTERN, ' ').trim();
}

/**
 * X 的服务端页面会把长文章正式标题写入 description 元数据。
 * 它比正文中的 h2 小标题更可靠，尤其适用于 status 页面内嵌长文章的情况。
 */
function readArticleMetadataTitle(document: Document, expectedId: string): string {
  // X 的 SPA 跳转可能短暂保留上一页 meta；URL 对不上当前 status 时必须丢弃，避免串页标题。
  const declaredUrl = cleanText(
    document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content
      || document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href,
  );
  if (declaredUrl && !declaredUrl.includes(expectedId)) return '';

  const selectors = [
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
    'meta[name="description"]',
  ];
  for (const selector of selectors) {
    const value = cleanText(document.querySelector<HTMLMetaElement>(selector)?.content);
    if (value.length >= 2 && !/^https?:\/\//i.test(value)) return value;
  }
  return '';
}

/**
 * 读取长文章真正标题。登录态 X 使用 `twitter-article-title`，公开页面则可能
 * 把标题 h1 放在 `.x-article-body` 前面；两种结构都不能从正文内部猜标题。
 */
function readArticleDomTitle(root: ParentNode, articleView: HTMLElement | null, articleBody: HTMLElement | null): string {
  const explicitTitle = root.querySelector<HTMLElement>(ARTICLE_TITLE_SELECTOR);
  const explicitText = cleanText(explicitTitle?.textContent);
  // 即使 X 未来把相同 testid 嵌入正文，也不允许把正文节点误认为正式标题。
  if (explicitText && !articleBody?.contains(explicitTitle)) return explicitText;

  // 优先查找正文或旧版阅读容器前方紧邻的 h1，兼容当前公开页面和登录后的 SPA 页面。
  for (const boundary of [articleBody, articleView]) {
    let sibling = boundary?.previousElementSibling;
    for (let index = 0; sibling && index < 3; index += 1, sibling = sibling.previousElementSibling) {
      const heading = sibling.matches('h1') ? sibling : sibling.querySelector('h1');
      const text = cleanText(heading?.textContent);
      if (text) return text;
    }
  }

  // 最后只接受正文区域之外的 h1；正文内部的 h1/h2 均可能只是章节标题。
  const outsideBodyHeading = Array.from(root.querySelectorAll<HTMLElement>('h1'))
    .find((heading) => !articleBody?.contains(heading));
  return cleanText(outsideBodyHeading?.textContent);
}

const COUNT_TOKEN_PATTERN = String.raw`\d[\d\s,.]*\s*(?:K|M|B|千|万|亿)?`;

/** 把 1,234、1.2K、2.5万 等页面缩写转换为整数。 */
function parseCompactCount(value: string): number | null {
  const match = cleanText(value).match(/(\d(?:[\d\s,.]*\d)?)\s*(K|M|B|千|万|亿)?/i);
  if (!match) return null;

  const unit = (match[2] ?? '').toUpperCase();
  const multiplier = unit === 'K' || unit === '千' ? 1_000
    : unit === 'M' || unit === '万' ? (unit === '万' ? 10_000 : 1_000_000)
      : unit === 'B' || unit === '亿' ? (unit === '亿' ? 100_000_000 : 1_000_000_000)
        : 1;
  const rawNumber = (match[1] ?? '').replace(/\s/g, '');
  // 无单位时互动数一定是整数，逗号和句点都按千位分隔符处理。
  const normalized = unit ? rawNumber.replace(',', '.') : rawNumber.replace(/[,.]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : null;
}

/** 从操作栏的 aria-label 中按中英文指标名称读取对应数字。 */
function parseLabeledCount(label: string, keywords: string[]): number | null {
  for (const keyword of keywords) {
    const match = label.match(new RegExp(`(${COUNT_TOKEN_PATTERN})\\s*(?:${keyword})`, 'i'));
    if (match?.[1]) return parseCompactCount(match[1]);
  }
  return null;
}

/** 从单个评论、转发等按钮的可见文字或无障碍标签中提取数字。 */
function parseMetricElement(root: ParentNode, selectors: string[]): number | null {
  for (const selector of selectors) {
    // 主帖操作栏通常位于内容末尾，取最后一个匹配项可避开内嵌引用帖的数据。
    const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const element = elements.at(-1);
    if (!element) continue;
    const candidates = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent];
    for (const candidate of candidates) {
      if (!candidate || !/\d/.test(candidate)) continue;
      const count = parseCompactCount(candidate);
      if (count !== null) return count;
    }
  }
  return null;
}

/**
 * 读取主内容操作栏中的五项公开互动数据。
 * 优先解析包含完整指标的 group 标签，再回退到各按钮，兼容 X 的中英文界面。
 */
function parseEngagementMetrics(root: ParentNode): EngagementMetrics {
  const metricLabel = Array.from(root.querySelectorAll<HTMLElement>('[role="group"][aria-label]'))
    .map((element) => element.getAttribute('aria-label') ?? '')
    .filter((label) => /repl|comment|repost|retweet|like|bookmark|view|回复|评论|转发|转帖|喜欢|点赞|收藏|书签|浏览|查看/i.test(label))
    .at(-1) ?? '';

  return {
    replyCount: parseLabeledCount(metricLabel, ['repl(?:y|ies)', 'comments?', '回复', '评论'])
      ?? parseMetricElement(root, ['[data-testid="reply"]']),
    repostCount: parseLabeledCount(metricLabel, ['reposts?', 'retweets?', '转发', '转帖'])
      ?? parseMetricElement(root, ['[data-testid="retweet"]', '[data-testid="unretweet"]']),
    viewCount: parseLabeledCount(metricLabel, ['views?', 'impressions?', '浏览(?:量|次数)?', '查看'])
      ?? parseMetricElement(root, ['a[href*="/analytics"]']),
    bookmarkCount: parseLabeledCount(metricLabel, ['bookmarks?', '收藏', '书签'])
      ?? parseMetricElement(root, ['[data-testid="bookmark"]', '[data-testid="removeBookmark"]']),
    likeCount: parseLabeledCount(metricLabel, ['likes?', '喜欢', '点赞'])
      ?? parseMetricElement(root, ['[data-testid="like"]', '[data-testid="unlike"]']),
  };
}

/** 从页面中找到链接指向指定 status ID 的主帖子容器，避免误抓回复内容。 */
function findStatusArticle(document: Document, postId: string): HTMLElement | null {
  const articles = Array.from(document.querySelectorAll<HTMLElement>('article'));
  return articles.find((article) =>
    Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')).some((anchor) =>
      anchor.getAttribute('href')?.includes(`/status/${postId}`),
    ),
  ) ?? null;
}

/** 从详情容器提取显示名称、用户名和头像地址。 */
function parseIdentity(root: ParentNode, routeHandle: string) {
  const userName = root.querySelector<HTMLElement>('[data-testid="User-Name"]');
  const identityText = cleanText(userName?.textContent);
  const handleMatch = identityText.match(/@([A-Za-z0-9_]+)/);
  const handle = handleMatch?.[1] ?? routeHandle;
  const authorName = cleanText(identityText.split(/@[A-Za-z0-9_]+/)[0]) || handle || '未知发布人';
  const avatar = Array.from(root.querySelectorAll<HTMLImageElement>('img')).find((image) =>
    /profile_images|profile_banners/i.test(image.src),
  );

  return {
    authorName,
    authorHandle: handle ? `@${handle.replace(/^@/, '')}` : '',
    authorAvatarUrl: avatar?.src ?? '',
  };
}

/** 限制列表标题长度，完整正文仍保存在 contentText 中。 */
function truncateTitle(value: string): string {
  return value.length > 88 ? `${value.slice(0, 88).trim()}…` : value;
}

/** 收集文章卡片中有意义且不重复的文本片段。 */
function meaningfulTextParts(root: ParentNode): string[] {
  const seen = new Set<string>();
  return Array.from(root.querySelectorAll<HTMLElement>('[dir="auto"], h1, h2, h3'))
    .map((element) => cleanText(element.textContent))
    .filter((text) => {
      if (text.length < 2 || seen.has(text) || /^@[A-Za-z0-9_]+$/.test(text)) return false;
      seen.add(text);
      return true;
    });
}

/** 定位 status 页面内嵌的长文章卡片，并兼容多个 X 页面结构。 */
function findArticleCard(root: ParentNode): HTMLElement | null {
  // 部分长文章先显示在帖子卡片中；优先使用明确的 article 链接，再使用结构特征兜底。
  const directArticleLink = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).find((anchor) =>
    /\/i\/article\/\d+/i.test(anchor.getAttribute('href') ?? ''),
  );
  if (directArticleLink) {
    return directArticleLink.closest<HTMLElement>('[data-testid="card.wrapper"], [data-testid*="article"]') ?? directArticleLink;
  }

  return root.querySelector<HTMLElement>(
    '[data-testid="card.wrapper"] a[href*="t.co"]:has([dir="auto"]), [data-testid*="article"]',
  )?.closest<HTMLElement>('[data-testid="card.wrapper"], [data-testid*="article"]') ?? null;
}

/** 移除作者、按钮和媒体等噪声节点后，生成最后一级详情正文回退文本。 */
function fallbackDetailText(root: ParentNode): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-testid="User-Name"], time, button, svg, img, [role="group"]').forEach((element) => element.remove());
  return cleanText(clone.textContent);
}

/** 判断内容类型，并按可靠性顺序选取标题与正文。 */
function detectContent(document: Document, root: ParentNode, routeKind: 'status' | 'article', routeId: string): { contentType: ContentType; title: string; contentText: string } {
  // 正文提取按“文章正文 → 文章卡片 → 帖子正文 → 清理后的详情文本”依次降级。
  const articleView = root.querySelector<HTMLElement>(ARTICLE_VIEW_SELECTOR);
  const articleBody = root.querySelector<HTMLElement>(ARTICLE_BODY_SELECTOR);
  const articleCard = findArticleCard(root);
  const articleRoot = articleBody ?? articleView ?? root;
  const articleTitle = readArticleDomTitle(root, articleView, articleBody);
  const tweetText = cleanText(root.querySelector<HTMLElement>('[data-testid="tweetText"]')?.textContent);

  const paragraphs = Array.from(articleRoot.querySelectorAll<HTMLElement>('p'))
    .map((paragraph) => cleanText(paragraph.textContent))
    .filter(Boolean);
  const paragraphText = cleanText(paragraphs.join(' '));
  const cardParts = articleCard ? meaningfulTextParts(articleCard) : [];
  const cardTitle = cardParts[0] ?? cleanText(articleCard?.textContent);
  const cardText = cleanText(cardParts.join(' ')) || cleanText(articleCard?.textContent);
  const fallbackText = fallbackDetailText(root);
  const isArticle = routeKind === 'article' || Boolean(articleView || articleCard);
  const metadataTitle = isArticle ? readArticleMetadataTitle(document, routeId) : '';
  const contentText = paragraphText || cardText || tweetText || fallbackText;
  const contentType: ContentType = isArticle ? 'article' : 'post';
  // 长文章只接受独立标题节点、属于当前 URL 的元数据或文章卡片标题，不再用正文小标题兜底。
  const sourceForTitle = isArticle
    ? articleTitle || metadataTitle || cardTitle
    : tweetText || contentText;
  const title = truncateTitle(sourceForTitle);

  return { contentType, title: title || (isArticle ? '' : 'X 内容'), contentText: contentText || sourceForTitle };
}

// 将详情页 DOM 转换为统一记录结构；核心正文未渲染完成时返回 null，交由短时观察器稍后重试。
export function parseXDetail(document: Document, inputUrl: string, now = new Date()): CapturedHistoryRecord | null {
  const route = matchXDetailRoute(inputUrl);
  if (!route) return null;

  const articleReadView = document.querySelector<HTMLElement>(ARTICLE_VIEW_SELECTOR);
  const statusArticle = route.kind === 'status' ? findStatusArticle(document, route.id) : null;
  if (route.kind === 'status' && !statusArticle) return null;
  const root = statusArticle ?? articleReadView?.closest<HTMLElement>('main') ?? document.querySelector<HTMLElement>('main');
  if (!root) return null;

  const { title, contentText, contentType } = detectContent(document, root, route.kind, route.id);
  // 长文章标题还未渲染时继续等待 DOM 更新，宁可稍后采集，也不保存正文中的章节标题。
  if (!title || !contentText || contentText.length < 2) return null;

  const identity = parseIdentity(root, route.handle);
  const timeElement = root.querySelector<HTMLTimeElement>('time[datetime]');
  const publishedAt = timeElement?.dateTime || timeElement?.getAttribute('datetime') || null;
  const canonicalUrl = canonicalizeXUrl(inputUrl, route);
  const engagement = parseEngagementMetrics(root);

  return {
    id: `x:${route.kind}:${route.id}`,
    source: 'x',
    contentType,
    url: canonicalUrl,
    canonicalUrl,
    postId: route.id,
    title,
    contentText,
    ...identity,
    ...engagement,
    publishedAt,
    visitedAt: now.toISOString(),
    parserVersion: PARSER_VERSION,
  };
}
