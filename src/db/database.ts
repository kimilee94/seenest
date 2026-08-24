import Dexie, { type EntityTable } from 'dexie';
import type { HistoryRecord } from '../types/history';

class SeenestDatabase extends Dexie {
  history!: EntityTable<HistoryRecord, 'id'>;

  constructor() {
    super('seenest');
    this.version(1).stores({
      history: '&id, source, contentType, postId, authorHandle, publishedAt, firstVisitedAt, lastVisitedAt',
    });
  }
}

export const db = new SeenestDatabase();
