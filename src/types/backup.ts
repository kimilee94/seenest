export type AutoBackupPermission = 'granted' | 'prompt' | 'denied' | 'unknown';

export interface AutoBackupWritable {
  write(data: Blob | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

/** 可被 IndexedDB 结构化克隆保存的文件授权句柄。 */
export interface AutoBackupFileHandle {
  readonly kind: 'file';
  readonly name: string;
  createWritable(): Promise<AutoBackupWritable>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<Exclude<AutoBackupPermission, 'unknown'>>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<Exclude<AutoBackupPermission, 'unknown'>>;
}

export interface AutoBackupRecord {
  key: 'primary';
  enabled: true;
  handle: AutoBackupFileHandle;
  fileName: string;
  permission: AutoBackupPermission;
  lastBackupAt: string | null;
  lastError: string;
}

export type AutoBackupResultStatus = 'written' | 'disabled' | 'permission-required' | 'failed';

export interface AutoBackupResult {
  status: AutoBackupResultStatus;
  config: AutoBackupRecord | null;
}
