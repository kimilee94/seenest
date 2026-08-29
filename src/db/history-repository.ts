import Dexie from 'dexie';
import { db } from './database';
import type {
  CapturedMemoryItem,
  CapturedVisit,
  ExportPayload,
  HistoryRecord,
  LegacyExportPayload,
  MemoryItem,
  VisitRecord,
} from '../types/history';
// 内容脚本每 30 秒结算一次；额外 5 秒容差可以覆盖事件调度延迟，但拒绝休眠后异常跳时。
const MAX_ACTIVE_TIME_INCREMENT_MS = 35_000;

export type HistoryTimeFilter = 'all' | 'today' | 'yesterday' | 'week';

export interface HistoryPageQuery {
  page: number;
  pageSize: number;
  query: string;
  source: string;
  timeFilter: HistoryTimeFilter;
  /** 精确日期使用设备本地时区的 YYYY-MM-DD；存在时优先于预置时间范围。 */
  selectedDate?: string | null;
  newestFirst: boolean;
}

export interface HistoryPageResult {
  items: HistoryRecord[];
  total: number;
}

/** 将时间筛选转换为本地自然日对应的 ISO 范围，结束时间不包含在查询内。 */
function getVisitTimeRange(filter: HistoryTimeFilter, selectedDate?: string | null): { start: string; end: string } | null {
  if (selectedDate) {
    const parts = selectedDate.split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      const [year, month, day] = parts as [number, number, number];
      const start = new Date(year, month - 1, day);
      const end = new Date(year, month - 1, day + 1);
      return { start: start.toISOString(), end: end.toISOString() };
    }
  }
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
function createHistoryCollection(source: string, timeFilter: HistoryTimeFilter, selectedDate?: string | null) {
  const range = getVisitTimeRange(timeFilter, selectedDate);
  if (source !== 'all') {
    return db.history.where('[source+lastSeenAt]').between(
      [source, range?.start ?? Dexie.minKey],
      [source, range?.end ?? Dexie.maxKey],
      true,
      !range,
    );
  }
  if (range) return db.history.where('lastSeenAt').between(range.start, range.end, true, false);
  return db.history.orderBy('lastSeenAt');
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
    const total = await createHistoryCollection(options.source, options.timeFilter, options.selectedDate).count();
    const ordered = createHistoryCollection(options.source, options.timeFilter, options.selectedDate);
    if (options.newestFirst) ordered.reverse();
    return {
      total,
      items: await ordered.offset((page - 1) * pageSize).limit(pageSize).toArray(),
    };
  }

  const matches = (await createHistoryCollection(options.source, options.timeFilter, options.selectedDate).toArray())
    .filter((record) => `${record.title} ${record.contentText} ${record.authorName} ${record.authorHandle} ${record.authorProfileUrl ?? ''} ${record.url}`
      .toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => Date.parse(left.lastSeenAt) - Date.parse(right.lastSeenAt));
  if (options.newestFirst) matches.reverse();
  return {
    total: matches.length,
    items: matches.slice((page - 1) * pageSize, page * pageSize),
  };
}

/** 合并平台重新解析出的字段，同时保留首次所见时间和之前抓到的有效媒体、互动数据。 */
export function mergeCapturedMemory(existing: MemoryItem, captured: CapturedMemoryItem, seenAt: string): MemoryItem {
  return {
    ...existing,
    ...captured,
    replyCount: captured.replyCount ?? existing.replyCount ?? null,
    repostCount: captured.repostCount ?? existing.repostCount ?? null,
    shareCount: captured.shareCount ?? existing.shareCount ?? null,
    viewCount: captured.viewCount ?? existing.viewCount ?? null,
    bookmarkCount: captured.bookmarkCount ?? existing.bookmarkCount ?? null,
    likeCount: captured.likeCount ?? existing.likeCount ?? null,
    mediaType: captured.mediaType ?? existing.mediaType,
    mediaUrl: captured.mediaUrl ?? existing.mediaUrl,
    mediaPreviewUrl: captured.mediaPreviewUrl ?? existing.mediaPreviewUrl,
    mediaAlt: captured.mediaAlt ?? existing.mediaAlt,
    durationSeconds: captured.durationSeconds ?? existing.durationSeconds ?? null,
    firstSeenAt: existing.firstSeenAt,
    lastSeenAt: seenAt,
    // 每次真实进入或刷新内容页都是一次 Visit；DOM 重试由采集运行器负责去重。
    visitCount: existing.visitCount + 1,
  };
}

export interface RecordedMemoryVisit {
  memory: MemoryItem;
  visit: VisitRecord;
}

function normalizeVisitStartedAt(value: string): string {
  const parsedStartedAt = new Date(value);
  return Number.isFinite(parsedStartedAt.getTime()) ? parsedStartedAt.toISOString() : new Date().toISOString();
}

function normalizeVisit(captured: CapturedVisit, memory: MemoryItem, tabId?: number): VisitRecord {
  const startedAt = normalizeVisitStartedAt(captured.startedAt);
  return {
    id: captured.id,
    memoryId: memory.id,
    source: memory.source,
    startedAt,
    endedAt: startedAt,
    activeDurationMs: 0,
    referrer: captured.referrer || undefined,
    tabId,
  };
}

/**
 * 在同一事务中写入一份内容记忆和一次访问。Visit ID 同时承担消息幂等键，
 * 即使同一采集消息意外送达两次，也不会重复增加访问次数。
 */
export async function recordCapturedMemoryVisit(
  captured: CapturedMemoryItem,
  visitInput: CapturedVisit,
  tabId?: number,
): Promise<RecordedMemoryVisit> {
  return db.transaction('rw', db.history, db.visits, async () => {
    const duplicateVisit = await db.visits.get(visitInput.id);
    if (duplicateVisit) {
      const existingMemory = await db.history.get(duplicateVisit.memoryId);
      if (existingMemory) return { memory: existingMemory, visit: duplicateVisit };
    }

    const startedAt = normalizeVisitStartedAt(visitInput.startedAt);
    const existing = await db.history.get(captured.id);
    let memory: MemoryItem;
    if (!existing) {
      memory = {
        ...captured,
        firstSeenAt: startedAt,
        lastSeenAt: startedAt,
        visitCount: 1,
        activeDurationMs: 0,
      };
      await db.history.add(memory);
    } else {
      memory = mergeCapturedMemory(existing, captured, startedAt);
      await db.history.put(memory);
    }

    const visit = normalizeVisit(visitInput, memory, tabId);
    await db.visits.put(visit);
    return { memory, visit };
  });
}

/** 平台详情刷新失败时，只要内容已经存在，仍然可以准确留下本次 Visit。 */
export async function recordVisitForExistingMemory(
  memoryId: string,
  visitInput: CapturedVisit,
  tabId?: number,
): Promise<RecordedMemoryVisit | null> {
  return db.transaction('rw', db.history, db.visits, async () => {
    const duplicateVisit = await db.visits.get(visitInput.id);
    if (duplicateVisit) {
      const duplicateMemory = await db.history.get(duplicateVisit.memoryId);
      return duplicateMemory ? { memory: duplicateMemory, visit: duplicateVisit } : null;
    }
    const existing = await db.history.get(memoryId);
    if (!existing) return null;
    const visit = normalizeVisit(visitInput, existing, tabId);
    const memory: MemoryItem = {
      ...existing,
      lastSeenAt: visit.startedAt,
      visitCount: existing.visitCount + 1,
    };
    await Promise.all([db.history.put(memory), db.visits.put(visit)]);
    return { memory, visit };
  });
}

/** 同时累加当前 Visit 和 Memory 汇总时长，既保留明细，也让列表查询无需逐条聚合。 */
export async function incrementActiveDuration(memoryId: string, visitId: string, durationMs: number, measuredAt: string): Promise<HistoryRecord | null> {
  const safeDuration = Math.min(MAX_ACTIVE_TIME_INCREMENT_MS, Math.max(0, Math.round(durationMs)));
  if (!memoryId || !visitId || safeDuration < 250) return null;
  const measuredDate = new Date(measuredAt);
  const safeMeasuredAt = Number.isFinite(measuredDate.getTime()) ? measuredDate.toISOString() : new Date().toISOString();

  return db.transaction('rw', db.history, db.visits, async () => {
    const [existing, visit] = await Promise.all([db.history.get(memoryId), db.visits.get(visitId)]);
    if (!existing || !visit || visit.memoryId !== memoryId) return null;
    const updated: HistoryRecord = {
      ...existing,
      activeDurationMs: Math.max(0, existing.activeDurationMs ?? 0) + safeDuration,
      activeMeasuredFrom: existing.activeMeasuredFrom ?? safeMeasuredAt,
      lastActiveAt: safeMeasuredAt,
    };
    await Promise.all([
      db.history.put(updated),
      db.visits.put({
        ...visit,
        endedAt: Date.parse(safeMeasuredAt) > Date.parse(visit.endedAt) ? safeMeasuredAt : visit.endedAt,
        activeDurationMs: Math.max(0, visit.activeDurationMs) + safeDuration,
        lastActiveAt: safeMeasuredAt,
      }),
    ]);
    return updated;
  });
}

/** 在离开路由或关闭页面时尽力补齐 Visit 的结束时间；重复消息按较晚时间幂等合并。 */
export async function endVisit(memoryId: string, visitId: string, endedAt: string): Promise<boolean> {
  const parsedEndedAt = new Date(endedAt);
  if (!memoryId || !visitId || !Number.isFinite(parsedEndedAt.getTime())) return false;
  return db.transaction('rw', db.visits, async () => {
    const visit = await db.visits.get(visitId);
    if (!visit || visit.memoryId !== memoryId) return false;
    const normalizedEnd = parsedEndedAt.toISOString();
    if (Date.parse(normalizedEnd) > Date.parse(visit.endedAt)) {
      await db.visits.put({ ...visit, endedAt: normalizedEnd });
    }
    return true;
  });
}

// JSON 备份保留完整字段，便于换设备或重装后恢复本地时光记录。
export async function exportHistory(): Promise<ExportPayload> {
  return {
    app: 'Seenest',
    version: 2,
    exportedAt: new Date().toISOString(),
    memories: await db.history.orderBy('lastSeenAt').reverse().toArray(),
    visits: await db.visits.orderBy('startedAt').reverse().toArray(),
  };
}

function normalizeLegacyMemory(record: LegacyExportPayload['records'][number]): MemoryItem | null {
  const firstSeenAt = record.firstSeenAt ?? record.firstVisitedAt;
  const lastSeenAt = record.lastSeenAt ?? record.lastVisitedAt;
  if (!record.id || !firstSeenAt || !lastSeenAt) return null;
  const { firstVisitedAt: _firstVisitedAt, lastVisitedAt: _lastVisitedAt, ...rest } = record;
  return { ...rest, firstSeenAt, lastSeenAt } as MemoryItem;
}

// v1 备份只恢复内容汇总；v2 同时恢复详细 Visit。相同主键始终使用 bulkPut 合并。
export async function importHistory(payload: ExportPayload | LegacyExportPayload, invalidMessage = 'Invalid Seenest backup file'): Promise<number> {
  if (payload.app !== 'Seenest') throw new Error(invalidMessage);
  if (payload.version === 1 && Array.isArray(payload.records)) {
    const memories = payload.records.map(normalizeLegacyMemory).filter((item): item is MemoryItem => item !== null);
    if (memories.length !== payload.records.length) throw new Error(invalidMessage);
    await db.history.bulkPut(memories);
    return memories.length;
  }
  if (payload.version === 2 && Array.isArray(payload.memories) && Array.isArray(payload.visits)) {
    await db.transaction('rw', db.history, db.visits, async () => {
      await db.history.bulkPut(payload.memories);
      await db.visits.bulkPut(payload.visits);
    });
    return payload.memories.length;
  }
  throw new Error(invalidMessage);
}

/** 清空全部本地内容记忆和访问明细。 */
export async function clearHistory(): Promise<void> {
  await db.transaction('rw', db.history, db.visits, async () => {
    await Promise.all([db.history.clear(), db.visits.clear()]);
  });
}
