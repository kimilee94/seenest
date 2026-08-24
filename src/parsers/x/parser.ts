import type { CapturedHistoryRecord, ContentType } from '../../types/history';
import { canonicalizeXUrl, matchXDetailRoute } from './route';

const PARSER_VERSION = 2;
const SPACE_PATTERN = /\s+/g;
const ARTICLE_VIEW_SELECTOR = [
  '[data-testid="twitterArticleReadView"]',
  '[data-testid="article-cover"]',
  '[data-testid="article-content"]',
].join(', ');

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(SPACE_PATTERN, ' ').trim();
}

function findStatusArticle(document: Document, postId: string): HTMLElement | null {
  const articles = Array.from(document.querySelectorAll<HTMLElement>('article'));
  return articles.find((article) =>
    Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')).some((anchor) =>
      anchor.getAttribute('href')?.includes(`/status/${postId}`),
    ),
  ) ?? null;
}

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

function truncateTitle(value: string): string {
  return value.length > 88 ? `${value.slice(0, 88).trim()}…` : value;
}

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

function findArticleCard(root: ParentNode): HTMLElement | null {
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

function fallbackDetailText(root: ParentNode): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-testid="User-Name"], time, button, svg, img, [role="group"]').forEach((element) => element.remove());
  return cleanText(clone.textContent);
}

function detectContent(root: ParentNode, routeKind: 'status' | 'article'): { contentType: ContentType; title: string; contentText: string } {
  const articleView = root.querySelector<HTMLElement>(ARTICLE_VIEW_SELECTOR);
  const articleCard = findArticleCard(root);
  const articleRoot = articleView ?? root;
  const heading = cleanText(articleRoot.querySelector('h1, h2')?.textContent);
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
  const contentText = paragraphText || cardText || tweetText || fallbackText;
  const contentType: ContentType = isArticle ? 'article' : 'post';
  const sourceForTitle = heading || cardTitle || tweetText || contentText;
  const title = truncateTitle(sourceForTitle);

  return { contentType, title: title || 'X 内容', contentText: contentText || sourceForTitle };
}

export function parseXDetail(document: Document, inputUrl: string, now = new Date()): CapturedHistoryRecord | null {
  const route = matchXDetailRoute(inputUrl);
  if (!route) return null;

  const articleReadView = document.querySelector<HTMLElement>(ARTICLE_VIEW_SELECTOR);
  const statusArticle = route.kind === 'status' ? findStatusArticle(document, route.id) : null;
  if (route.kind === 'status' && !statusArticle) return null;
  const root = statusArticle ?? articleReadView?.closest<HTMLElement>('main') ?? document.querySelector<HTMLElement>('main');
  if (!root) return null;

  const { title, contentText, contentType } = detectContent(root, route.kind);
  if (!contentText || contentText.length < 2) return null;

  const identity = parseIdentity(root, route.handle);
  const timeElement = root.querySelector<HTMLTimeElement>('time[datetime]');
  const publishedAt = timeElement?.dateTime || timeElement?.getAttribute('datetime') || null;
  const canonicalUrl = canonicalizeXUrl(inputUrl, route);

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
    publishedAt,
    visitedAt: now.toISOString(),
    parserVersion: PARSER_VERSION,
  };
}
