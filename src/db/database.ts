import Dexie, { type EntityTable } from 'dexie';
import type { AutoBackupRecord } from '../types/backup';
import type { MemoryItem, VisitRecord } from '../types/history';

class SeenestDatabase extends Dexie {
  /** 物理表名为 history 是为了无损兼容旧版本；表中的每一行现在代表一个 MemoryItem。 */
  history!: EntityTable<MemoryItem, 'id'>;
  visits!: EntityTable<VisitRecord, 'id'>;
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
    // 第四版正式拆分 Memory 与 Visit。旧内容原地迁移，详细访问仅从升级后开始记录。
    this.version(4).stores({
      history: '&id, source, [source+lastSeenAt], contentType, postId, authorHandle, publishedAt, firstSeenAt, lastSeenAt',
      visits: '&id, memoryId, [memoryId+startedAt], source, startedAt',
      autoBackup: '&key',
    }).upgrade(async (transaction) => {
      await transaction.table('history').toCollection().modify((record: Record<string, unknown>) => {
        record.firstSeenAt = record.firstSeenAt ?? record.firstVisitedAt;
        record.lastSeenAt = record.lastSeenAt ?? record.lastVisitedAt;
        delete record.firstVisitedAt;
        delete record.lastVisitedAt;
      });
    });
  }
}

export const db = new SeenestDatabase();
