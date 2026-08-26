import Dexie, { type EntityTable } from 'dexie';
import type { AutoBackupRecord } from '../types/backup';
import type { HistoryRecord } from '../types/history';

class SeenestDatabase extends Dexie {
  history!: EntityTable<HistoryRecord, 'id'>;
  autoBackup!: EntityTable<AutoBackupRecord, 'key'>;

  constructor() {
    super('seenest');
    // &id 是唯一主键，用它保证同一条 X 内容在数据库中始终只有一份记录。
    this.version(1).stores({
      history: '&id, source, contentType, postId, authorHandle, publishedAt, firstVisitedAt, lastVisitedAt',
    });
    // 第二版只新增备份授权表，原有 history 表及数据会原样保留。
    this.version(2).stores({
      history: '&id, source, contentType, postId, authorHandle, publishedAt, firstVisitedAt, lastVisitedAt',
      autoBackup: '&key',
    });
    // 第三版增加来源与浏览时间复合索引，为多平台筛选和数据库分页提供高效查询能力。
    this.version(3).stores({
      history: '&id, source, [source+lastVisitedAt], contentType, postId, authorHandle, publishedAt, firstVisitedAt, lastVisitedAt',
      autoBackup: '&key',
    });
  }
}

export const db = new SeenestDatabase();
