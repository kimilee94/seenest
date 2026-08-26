import { db } from '../db/database';
import { exportHistory } from '../db/history-repository';
import type {
  AutoBackupFileHandle,
  AutoBackupPermission,
  AutoBackupRecord,
  AutoBackupResult,
} from '../types/backup';

export const AUTO_BACKUP_KEY = 'primary' as const;

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<AutoBackupFileHandle>;

/** 读取当前浏览器是否提供用户授权的文件保存选择器。 */
function getSaveFilePicker(): SaveFilePicker | null {
  const picker = (globalThis as typeof globalThis & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return picker ? picker.bind(globalThis) : null;
}

/** 查询后台是否仍拥有文件写入权限；旧实现缺少查询方法时按已授权处理。 */
async function queryWritePermission(handle: AutoBackupFileHandle): Promise<AutoBackupPermission> {
  if (!handle.queryPermission) return 'granted';
  try {
    return await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    return 'unknown';
  }
}

/** 仅在用户点击操作时重新请求写入权限，后台任务不会主动弹出系统授权窗口。 */
async function requestWritePermission(handle: AutoBackupFileHandle): Promise<AutoBackupPermission> {
  if (!handle.requestPermission) return queryWritePermission(handle);
  try {
    return await handle.requestPermission({ mode: 'readwrite' });
  } catch {
    return 'denied';
  }
}

/** 将完整 Seenest 备份写入已授权文件，close() 成功后才算完成一次快照。 */
async function writeSnapshot(handle: AutoBackupFileHandle): Promise<void> {
  const payload = await exportHistory();
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    await writable.close();
  } catch (error) {
    // 写入中断时尽量释放文件锁；保留原文件由浏览器的安全写入机制负责。
    try { await writable.abort?.(); } catch { /* 文件流可能已经自动关闭。 */ }
    throw error;
  }
}

/** 把最近一次备份状态写回 IndexedDB，供数据管理页实时展示。 */
async function saveStatus(config: AutoBackupRecord): Promise<AutoBackupRecord> {
  await db.autoBackup.put(config);
  return config;
}

/** 获取当前自动备份配置；没有配置表示用户尚未开启。 */
export async function getAutoBackupConfig(): Promise<AutoBackupRecord | undefined> {
  return db.autoBackup.get(AUTO_BACKUP_KEY);
}

/**
 * 写入一次自动备份快照。
 * 后台权限失效时只记录状态，不弹窗、不阻塞帖子采集。
 */
export async function writeAutoBackupSnapshot(): Promise<AutoBackupResult> {
  const config = await getAutoBackupConfig();
  if (!config?.enabled) return { status: 'disabled', config: null };

  const permission = await queryWritePermission(config.handle);
  if (permission !== 'granted') {
    const next = await saveStatus({
      ...config,
      permission,
      lastError: '需要重新授权备份文件',
    });
    return { status: 'permission-required', config: next };
  }

  try {
    await writeSnapshot(config.handle);
    const next = await saveStatus({
      ...config,
      permission: 'granted',
      lastBackupAt: new Date().toISOString(),
      lastError: '',
    });
    return { status: 'written', config: next };
  } catch (error) {
    const next = await saveStatus({
      ...config,
      permission,
      lastError: error instanceof Error ? error.message : '写入备份失败',
    });
    return { status: 'failed', config: next };
  }
}

/** 由用户主动选择一个 JSON 文件，保存授权句柄并立即生成第一份快照。 */
export async function connectAutoBackupFile(): Promise<AutoBackupResult> {
  const picker = getSaveFilePicker();
  if (!picker) throw new Error('当前浏览器不支持自动本地备份');

  const handle = await picker({
    suggestedName: 'seenest-auto-backup.json',
    types: [{
      description: 'Seenest JSON 备份',
      accept: { 'application/json': ['.json'] },
    }],
  });
  await saveStatus({
    key: AUTO_BACKUP_KEY,
    enabled: true,
    handle,
    fileName: handle.name,
    permission: 'granted',
    lastBackupAt: null,
    lastError: '',
  });
  return writeAutoBackupSnapshot();
}

/** 对已保存的文件句柄重新发起授权，并在成功后立刻刷新备份。 */
export async function reconnectAutoBackupFile(existingConfig?: AutoBackupRecord): Promise<AutoBackupResult> {
  // 页面会传入实时查询到的配置，让 requestPermission 尽可能紧跟用户点击执行。
  const config = existingConfig ?? await getAutoBackupConfig();
  if (!config) return connectAutoBackupFile();

  const permission = await requestWritePermission(config.handle);
  if (permission !== 'granted') {
    const next = await saveStatus({
      ...config,
      permission,
      lastError: '未获得备份文件写入权限',
    });
    return { status: 'permission-required', config: next };
  }

  await saveStatus({ ...config, permission: 'granted', lastError: '' });
  return writeAutoBackupSnapshot();
}

/** 关闭自动备份并移除文件授权记录；不会删除用户磁盘上的备份文件。 */
export async function disconnectAutoBackupFile(): Promise<void> {
  await db.autoBackup.delete(AUTO_BACKUP_KEY);
}
