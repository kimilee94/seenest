import { db } from './database';
import type { CapturedHistoryRecord, ExportPayload, HistoryRecord } from '../types/history';

const VISIT_SESSION_WINDOW_MS = 30 * 60 * 1000;

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
      firstVisitedAt: existing.firstVisitedAt,
      lastVisitedAt: captured.visitedAt,
      visitCount: existing.visitCount + (isNewVisit ? 1 : 0),
    };
    await db.history.put(record);
    return record;
  });
}

export async function exportHistory(): Promise<ExportPayload> {
  return {
    app: 'Seenest',
    version: 1,
    exportedAt: new Date().toISOString(),
    records: await db.history.orderBy('lastVisitedAt').reverse().toArray(),
  };
}

export async function importHistory(payload: ExportPayload): Promise<number> {
  if (payload.app !== 'Seenest' || payload.version !== 1 || !Array.isArray(payload.records)) {
    throw new Error('这不是有效的 Seenest 备份文件');
  }
  await db.history.bulkPut(payload.records);
  return payload.records.length;
}

export async function clearHistory(): Promise<void> {
  await db.history.clear();
}
