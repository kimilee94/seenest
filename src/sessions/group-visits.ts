import type { VisitRecord } from '../types/history';

export const DEFAULT_SESSION_GAP_MS = 30 * 60 * 1_000;

export interface BrowsingSession {
  id: string;
  startedAt: string;
  endedAt: string;
  activeDurationMs: number;
  visits: VisitRecord[];
}

/**
 * 按时间动态归组 Visit，相邻访问间隔小于 30 分钟属于同一 Session。
 * 第一版不持久化 Session，避免用户修改阈值后还要迁移数据库。
 */
export function groupVisitsIntoSessions(
  visits: VisitRecord[],
  gapMs = DEFAULT_SESSION_GAP_MS,
): BrowsingSession[] {
  const ordered = [...visits].sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  const sessions: BrowsingSession[] = [];

  for (const visit of ordered) {
    const previous = sessions.at(-1);
    const previousEnd = previous ? Date.parse(previous.endedAt) : Number.NaN;
    const visitStart = Date.parse(visit.startedAt);
    if (!previous || !Number.isFinite(previousEnd) || !Number.isFinite(visitStart) || visitStart - previousEnd >= gapMs) {
      sessions.push({
        id: `session:${visit.id}`,
        startedAt: visit.startedAt,
        endedAt: visit.endedAt,
        activeDurationMs: visit.activeDurationMs,
        visits: [visit],
      });
      continue;
    }

    previous.visits.push(visit);
    if (Date.parse(visit.endedAt) > Date.parse(previous.endedAt)) previous.endedAt = visit.endedAt;
    previous.activeDurationMs += visit.activeDurationMs;
  }

  return sessions;
}
