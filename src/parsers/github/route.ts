export type GithubRoute =
  | { kind: 'repository'; owner: string; repo: string; canonicalUrl: string }
  | { kind: 'issue'; owner: string; repo: string; issueNumber: number; canonicalUrl: string };

const RESERVED_ROOTS = new Set([
  'about', 'account', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise',
  'events', 'explore', 'features', 'issues', 'login', 'marketplace', 'new', 'notifications',
  'organizations', 'orgs', 'pricing', 'pulls', 'search', 'security', 'settings', 'signup',
  'site', 'sponsors', 'topics', 'trending', 'users',
]);

/** 只接受公开仓库首页和单条 Issue；列表、PR、文件、提交等页面不会进入采集流程。 */
export function matchGithubMemoryRoute(input: string): GithubRoute | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length < 2 || RESERVED_ROOTS.has(parts[0]!.toLowerCase())) return null;
  const [owner, repo] = parts;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo!)) return null;

  const repoUrl = `https://github.com/${owner}/${repo}`;
  if (parts.length === 2) return { kind: 'repository', owner: owner!, repo: repo!, canonicalUrl: repoUrl };
  if (parts.length === 4 && parts[2] === 'issues' && /^\d+$/.test(parts[3]!)) {
    const issueNumber = Number(parts[3]);
    if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return null;
    return { kind: 'issue', owner: owner!, repo: repo!, issueNumber, canonicalUrl: `${repoUrl}/issues/${issueNumber}` };
  }
  return null;
}
