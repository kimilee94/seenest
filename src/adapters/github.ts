import { parseGithubMemory } from '../parsers/github/parser';
import { matchGithubMemoryRoute } from '../parsers/github/route';
import type { CapturedMemoryItem } from '../types/history';
import type { SiteAdapter } from './types';

export const githubAdapter: SiteAdapter<CapturedMemoryItem> = {
  source: 'github',
  match(url) {
    return matchGithubMemoryRoute(url.href) !== null;
  },
  getRouteKey(url) {
    const route = matchGithubMemoryRoute(url.href);
    if (!route) return null;
    return route.kind === 'repository'
      ? `repository:${route.owner.toLowerCase()}/${route.repo.toLowerCase()}`
      : `issue:${route.owner.toLowerCase()}/${route.repo.toLowerCase()}:${route.issueNumber}`;
  },
  capture({ document, url }) {
    return parseGithubMemory(document, url.href);
  },
};
