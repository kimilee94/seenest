import type { CapturedMemoryItem } from '../../types/history';
import { matchGithubMemoryRoute, type GithubRoute } from './route';

const README_LIMIT = 1_000;
const ISSUE_BODY_LIMIT = 500;

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** 截断时把省略号计算在上限内，确保 IndexedDB 中不会存入超过约定长度的正文。 */
function truncateText(value: string, limit: number): { text: string; truncated: boolean } {
  const text = normalizedText(value);
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit - 1).trimEnd()}…`, truncated: true };
}

function metaContent(document: Document, selector: string): string {
  return normalizedText(document.querySelector<HTMLMetaElement>(selector)?.content);
}

/** GitHub 在页面 meta 中标记仓库可见性；仅在明确识别为 Public 时继续，无法确认则安全跳过。 */
function isPublicRepository(document: Document): boolean {
  const publicMeta = metaContent(document, 'meta[name="octolytics-dimension-repository_public"]');
  if (publicMeta) return publicMeta.toLowerCase() === 'true';
  const visibility = normalizedText(document.querySelector('[data-testid="repository-visibility-label"], #repository-container-header .Label')?.textContent);
  return /^(public|公开)$/i.test(visibility);
}

function parseCompactNumber(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim().toLowerCase();
  const match = normalized.match(/([\d.]+)\s*([kmb万亿]?)/);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multipliers: Record<string, number> = { '': 1, k: 1_000, m: 1_000_000, b: 1_000_000_000, 万: 10_000, 亿: 100_000_000 };
  return Math.round(base * (multipliers[match[2] ?? ''] ?? 1));
}

function firstNumber(document: Document, selectors: string[]): number | null {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element?.getAttribute('title') || element?.getAttribute('aria-label') || element?.textContent || '';
    const parsed = parseCompactNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function safeHttpsUrl(value: string | null | undefined, baseUrl = 'https://github.com'): string {
  if (!value) return '';
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function safeGithubPageUrl(value: string | null | undefined): string {
  const url = safeHttpsUrl(value);
  if (!url) return '';
  return new URL(url).hostname === 'github.com' ? url : '';
}

function findOwnerAvatar(document: Document, owner: string): string {
  const ownerPath = `/${owner}`.toLowerCase();
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const ownerLink = links.find((link) => {
    try { return new URL(link.href).pathname.replace(/\/$/, '').toLowerCase() === ownerPath && Boolean(link.querySelector('img.avatar, img')); } catch { return false; }
  });
  return safeHttpsUrl(ownerLink?.querySelector<HTMLImageElement>('img')?.src);
}

interface EmbeddedRepositoryData {
  description?: string;
  topics?: string[];
  stargazerCount?: number;
  forksCount?: number;
  ownerAvatarUrl?: string;
  readmeHtml?: string;
  createdAt?: string;
}

/** GitHub 新版仓库页会先把 README 放在页面内的 React JSON 中；读取该内联数据可避免等待网络或调用 API。 */
function readEmbeddedRepositoryData(document: Document): EmbeddedRepositoryData {
  const script = document.querySelector<HTMLScriptElement>('script[data-target="react-app.embeddedData"]');
  if (!script?.textContent) return {};
  try {
    const payload = JSON.parse(script.textContent) as {
      payload?: {
        sidebarAbout?: {
          description?: string;
          topics?: string[];
          stargazerCount?: number;
          forksCount?: number;
          repo?: { ownerAvatarUrl?: string };
        };
        codeViewRepoRoute?: {
        overview?: { overviewFiles?: Array<{ preferredFileType?: string; richText?: string | null }> };
        };
        codeViewLayoutRoute?: { repo?: { createdAt?: string } };
      };
    };
    const route = payload.payload?.codeViewRepoRoute;
    const sidebar = payload.payload?.sidebarAbout;
    return {
      description: sidebar?.description,
      topics: sidebar?.topics,
      stargazerCount: sidebar?.stargazerCount,
      forksCount: sidebar?.forksCount,
      ownerAvatarUrl: sidebar?.repo?.ownerAvatarUrl,
      readmeHtml: route?.overview?.overviewFiles?.find((file) => file.preferredFileType === 'readme')?.richText ?? undefined,
      createdAt: payload.payload?.codeViewLayoutRoute?.repo?.createdAt,
    };
  } catch {
    return {};
  }
}

/** 从 README 按视觉阅读顺序摘取标题、段落、列表和代码，过滤徽章与重复文本。 */
function summarizeReadmeRoot(root: HTMLElement | null, repoName: string) {
  if (!root) return { text: '', headings: [] as string[], truncated: false };
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img, svg, video, picture, iframe, style, script, table').forEach((node) => node.remove());

  const headings: string[] = [];
  const chunks: string[] = [];
  const seen = new Set<string>();
  for (const node of Array.from(clone.querySelectorAll<HTMLElement>('h1, h2, h3, p, li, pre'))) {
    const text = normalizedText(node.textContent);
    if (!text || text.length < 2 || seen.has(text) || (node.tagName === 'H1' && text.toLowerCase() === repoName.toLowerCase())) continue;
    // 列表项中的嵌套段落会被单独选中，保留先出现的一份即可。
    if (node.matches('p') && node.closest('li')) continue;
    seen.add(text);
    if (/^H[1-3]$/.test(node.tagName) && headings.length < 20) headings.push(text);
    chunks.push(/^H[1-3]$/.test(node.tagName) ? `${text}\n` : text);
  }
  const summary = truncateText(chunks.join('\n'), README_LIMIT);
  return { text: summary.text, headings, truncated: summary.truncated };
}

function extractReadmeSummary(document: Document, repoName: string, embeddedHtml?: string) {
  const root = document.querySelector<HTMLElement>('#readme article.markdown-body, #readme .markdown-body, article.markdown-body');
  if (root) return summarizeReadmeRoot(root, repoName);
  if (!embeddedHtml) return summarizeReadmeRoot(null, repoName);
  const holder = document.createElement('div');
  holder.innerHTML = embeddedHtml;
  return summarizeReadmeRoot(holder.querySelector<HTMLElement>('article.markdown-body, .markdown-body'), repoName);
}

function parseRepository(document: Document, route: Extract<GithubRoute, { kind: 'repository' }>): CapturedMemoryItem | null {
  const embedded = readEmbeddedRepositoryData(document);
  const metaDescription = metaContent(document, 'meta[name="description"]').replace(new RegExp(`\\s+-\\s+${route.owner}/${route.repo}$`, 'i'), '');
  const description = normalizedText(document.querySelector<HTMLElement>('[itemprop="about"], [data-pjax="#repo-content-pjax-container"] [data-testid="about-description"]')?.textContent)
    || normalizedText(embedded.description) || metaDescription;
  const readme = extractReadmeSummary(document, route.repo, embedded.readmeHtml);
  const domTopics = Array.from(document.querySelectorAll<HTMLAnchorElement>('a.topic-tag, [data-testid="repository-topics-container"] a, a[href^="/topics/"]'))
    .map((node) => normalizedText(node.textContent)).filter(Boolean).filter((topic, index, values) => values.indexOf(topic) === index).slice(0, 20);
  const topics = domTopics.length ? domTopics : (embedded.topics ?? []).map(normalizedText).filter(Boolean).slice(0, 20);
  if (!description && !readme.text && !topics.length) return null;

  const stars = firstNumber(document, ['#repo-stars-counter-star', '[data-testid="stargazers-count"]', 'a[href$="/stargazers"] strong', 'a[href$="/stargazers"]']) ?? embedded.stargazerCount ?? null;
  const forks = firstNumber(document, ['#repo-network-counter', 'a[href$="/forks"] strong', 'a[href$="/forks"]']) ?? embedded.forksCount ?? null;
  const language = normalizedText(document.querySelector('[itemprop="programmingLanguage"]')?.textContent);
  const preview = safeHttpsUrl(metaContent(document, 'meta[property="og:image"]'));
  const createdTimestamp = embedded.createdAt ? Date.parse(embedded.createdAt) : Number.NaN;
  const createdAt = Number.isFinite(createdTimestamp) ? new Date(createdTimestamp).toISOString() : null;
  const contentParts = [description, readme.text].filter((value, index, values) => value && values.indexOf(value) === index);
  const fullName = `${route.owner}/${route.repo}`;

  return {
    id: `github:repository:${fullName.toLowerCase()}`,
    source: 'github',
    contentType: 'repository',
    url: route.canonicalUrl,
    canonicalUrl: route.canonicalUrl,
    postId: fullName,
    title: route.repo,
    contentText: contentParts.join('\n\n'),
    authorName: route.owner,
    authorHandle: route.owner,
    authorProfileUrl: `https://github.com/${route.owner}`,
    authorAvatarUrl: findOwnerAvatar(document, route.owner) || safeHttpsUrl(embedded.ownerAvatarUrl),
    mediaType: preview ? 'image' : undefined,
    mediaUrl: preview || undefined,
    mediaPreviewUrl: preview || undefined,
    mediaAlt: preview ? `${fullName} repository preview` : undefined,
    repostCount: forks,
    likeCount: stars,
    // 统一数据模型继续使用 publishedAt；GitHub 仓库在界面中会按“创建于”展示该 createdAt。
    publishedAt: createdAt,
    parserVersion: 1,
    metadata: { githubKind: 'repository', fullName, description, readmeSummary: readme.text, readmeHeadings: readme.headings, readmeTruncated: readme.truncated, stars, forks, language, topics, createdAt },
  };
}

function issueRoot(document: Document): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="issue-body"], .timeline-comment--caret, .js-comment-container, .js-issue-row');
}

function parseIssue(document: Document, route: Extract<GithubRoute, { kind: 'issue' }>): CapturedMemoryItem | null {
  const root = issueRoot(document);
  const title = normalizedText(document.querySelector('[data-testid="issue-title"], bdi.js-issue-title, bdi.markdown-title')?.textContent)
    || metaContent(document, 'meta[property="og:title"]').replace(/\s*·\s*Issue\s*#\d+.*$/i, '');
  const bodyElement = root?.querySelector<HTMLElement>('[data-testid="issue-body-content"], .comment-body, .js-comment-body .markdown-body, .markdown-body')
    || document.querySelector<HTMLElement>('[data-testid="issue-body-content"], .timeline-comment--caret .comment-body, .js-comment-body .markdown-body');
  const body = truncateText(normalizedText(bodyElement?.textContent) || metaContent(document, 'meta[name="description"]'), ISSUE_BODY_LIMIT);
  if (!title || !body.text) return null;

  const authorLink = root?.querySelector<HTMLAnchorElement>('[data-testid="issue-body-header-author"], a[data-hovercard-type="user"], a.author, a.Link--primary[href^="/"]');
  const authorHandle = normalizedText(authorLink?.textContent).replace(/^@/, '') || route.owner;
  const authorProfileUrl = safeGithubPageUrl(authorLink?.href) || `https://github.com/${authorHandle}`;
  const avatar = safeHttpsUrl(root?.querySelector<HTMLImageElement>('img.avatar, img[data-component="Avatar"]')?.src);
  const publishedElement = root?.querySelector<HTMLElement>('relative-time, time[datetime]');
  const publishedValue = publishedElement?.getAttribute('datetime') || normalizedText(publishedElement?.textContent).replace(/^on\s+/i, '');
  const parsedPublishedAt = publishedValue ? Date.parse(publishedValue) : Number.NaN;
  const publishedAt = Number.isFinite(parsedPublishedAt) ? new Date(parsedPublishedAt).toISOString() : null;
  const state = normalizedText(document.querySelector('[data-testid="issue-state"], [data-testid="header-state"], .State')?.textContent).toLowerCase();
  const labels = Array.from(document.querySelectorAll<HTMLAnchorElement>(`[data-testid="issue-labels"] a, a[href*="/${route.owner}/${route.repo}/issues?q="][href*="label"], a[href*="/${route.owner}/${route.repo}/labels/"]`))
    .map((node) => normalizedText(node.textContent)).filter(Boolean).filter((label, index, values) => values.indexOf(label) === index).slice(0, 20);
  const fullName = `${route.owner}/${route.repo}`;

  return {
    id: `github:issue:${fullName.toLowerCase()}:${route.issueNumber}`,
    source: 'github',
    contentType: 'issue',
    url: route.canonicalUrl,
    canonicalUrl: route.canonicalUrl,
    postId: `${fullName}#${route.issueNumber}`,
    title,
    contentText: body.text,
    authorName: authorHandle,
    authorHandle,
    authorProfileUrl,
    authorAvatarUrl: avatar,
    publishedAt,
    parserVersion: 1,
    metadata: { githubKind: 'issue', fullName, issueNumber: route.issueNumber, state, labels, bodyTruncated: body.truncated },
  };
}

/** 解析 GitHub 已渲染的公开 DOM，不发起 API 请求，也不会访问未打开的页面。 */
export function parseGithubMemory(document: Document, inputUrl: string): CapturedMemoryItem | null {
  const route = matchGithubMemoryRoute(inputUrl);
  if (!route || !isPublicRepository(document)) return null;
  return route.kind === 'repository' ? parseRepository(document, route) : parseIssue(document, route);
}
