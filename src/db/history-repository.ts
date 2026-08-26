import Dexie from 'dexie';
import { db } from './database';
import type { CapturedHistoryRecord, ExportPayload, HistoryRecord } from '../types/history';

// 30 分钟内反复打开同一内容视为同一次浏览会话，只更新时间，不增加访问次数。
const VISIT_SESSION_WINDOW_MS = 30 * 60 * 1000;

export type HistoryTimeFilter = 'all' | 'today' | 'yesterday' | 'week';

export interface HistoryPageQuery {
  page: number;
  pageSize: number;
  query: string;
  source: string;
  timeFilter: HistoryTimeFilter;
  newestFirst: boolean;
}

export interface HistoryPageResult {
  items: HistoryRecord[];
  total: number;
}

/** 将时间筛选转换为本地自然日对应的 ISO 范围，结束时间不包含在查询内。 */
function getVisitTimeRange(filter: HistoryTimeFilter): { start: string; end: string } | null {
  if (filter === 'all') return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  const end = new Date(today);
  end.setDate(end.getDate() + 1);
  if (filter === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (filter === 'week') {
    start.setDate(start.getDate() - 6);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

/** 根据来源和时间范围创建可复用的 Dexie 集合。 */
function createHistoryCollection(source: string, timeFilter: HistoryTimeFilter) {
  const range = getVisitTimeRange(timeFilter);
  if (source !== 'all') {
    return db.history.where('[source+lastVisitedAt]').between(
      [source, range?.start ?? Dexie.minKey],
      [source, range?.end ?? Dexie.maxKey],
      true,
      !range,
    );
  }
  if (range) return db.history.where('lastVisitedAt').between(range.start, range.end, true, false);
  return db.history.orderBy('lastVisitedAt');
}

/**
 * 查询一页浏览记录。无关键词时直接使用 IndexedDB 索引分页；
 * 关键词搜索才扫描当前来源与时间范围，仍然只在本机进行。
 */
export async function queryHistoryPage(options: HistoryPageQuery): Promise<HistoryPageResult> {
  const page = Math.max(1, options.page);
  const pageSize = Math.max(1, options.pageSize);
  const normalizedQuery = options.query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    const total = await createHistoryCollection(options.source, options.timeFilter).count();
    const ordered = createHistoryCollection(options.source, options.timeFilter);
    if (options.newestFirst) ordered.reverse();
    return {
      total,
      items: await ordered.offset((page - 1) * pageSize).limit(pageSize).toArray(),
    };
  }

  const matches = (await createHistoryCollection(options.source, options.timeFilter).toArray())
    .filter((record) => `${record.title} ${record.contentText} ${record.authorName} ${record.authorHandle} ${record.authorProfileUrl ?? ''} ${record.url}`
      .toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => Date.parse(left.lastVisitedAt) - Date.parse(right.lastVisitedAt));
  if (options.newestFirst) matches.reverse();
  return {
    total: matches.length,
    items: matches.slice((page - 1) * pageSize, page * pageSize),
  };
}

// 记录 ID 由平台、内容类型和帖子 ID 组成。事务内的 upsert 保证重复访问不会生成重复行。
export async function upsertCapturedRecord(captured: CapturedHistoryRecord): Promise<HistoryRecord> {
  return db.transaction('rw', db.history, async () => {
    const existing = await db.history.get(captured.id);

    if (!existing) {
      const record: HistoryRecord = {
        ...captured,
        firstVisitedAt: captured.visitedAt,
        lastVisitedAt: captured.visitedAt,
        visitCount: 1,
      };
      await db.history.add(record);
      return record;
    }

    const isNewVisit = Date.parse(captured.visitedAt) - Date.parse(existing.lastVisitedAt) > VISIT_SESSION_WINDOW_MS;
    const record: HistoryRecord = {
      ...existing,
      ...captured,
      // 某项指标未渲染时沿用上一次有效值，避免把已抓到的数据覆盖为空。
      replyCount: captured.replyCount ?? existing.replyCount ?? null,
      repostCount: captured.repostCount ?? existing.repostCount ?? null,
      viewCount: captured.viewCount ?? existing.viewCount ?? null,
      bookmarkCount: captured.bookmarkCount ?? existing.bookmarkCount ?? null,
      likeCount: captured.likeCount ?? existing.likeCount ?? null,
      firstVisitedAt: existing.firstVisitedAt,
      lastVisitedAt: captured.visitedAt,
      visitCount: existing.visitCount + (isNewVisit ? 1 : 0),
    };
    await db.history.put(record);
    return record;
  });
}

// JSON 备份保留完整字段，便于换设备或重装后恢复本地时光记录。
export async function exportHistory(): Promise<ExportPayload> {
  return {
    app: 'Seenest',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: await db.history.orderBy('lastVisitedAt').reverse().toArray(),
  };
}

// 导入前校验应用标识和备份版本；bulkPut 会按主键合并相同记录。
export async function importHistory(payload: ExportPayload): Promise<number> {
  if (payload.app !== 'Seenest' || payload.version !== 1 || !Array.isArray(payload.records)) {
    throw new Error('这不是有效的 Seenest 备份文件');
  }
  await db.history.bulkPut(payload.records);
  return payload.records.length;
}

/** 清空当前扩展来源下的全部本地历史记录。 */
export async function clearHistory(): Promise<void> {
  await db.history.clear();
}
