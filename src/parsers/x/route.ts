export interface XDetailRoute {
  kind: 'status' | 'article';
  id: string;
  handle: string;
}

const RESERVED_HANDLES = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'compose', 'i']);

export function matchXDetailRoute(input: string): XDetailRoute | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;

  const status = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
  if (status?.[1] && status[2] && !RESERVED_HANDLES.has(status[1].toLowerCase())) {
    return { kind: 'status', handle: status[1], id: status[2] };
  }

  const article = url.pathname.match(/^\/i\/article\/(\d+)/i);
  if (article?.[1]) return { kind: 'article', handle: '', id: article[1] };

  return null;
}

export function canonicalizeXUrl(input: string, route: XDetailRoute): string {
  if (route.kind === 'status') return `https://x.com/${route.handle}/status/${route.id}`;
  return `https://x.com/i/article/${route.id}`;
}
