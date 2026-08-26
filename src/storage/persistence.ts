/**
 * 请求浏览器将扩展来源的 IndexedDB 标记为持久存储。
 *
 * manifest 中的 unlimitedStorage 会解除 IndexedDB 配额与逐出限制；
 * persist() 是额外保护。部分浏览器可能不支持或拒绝请求，因此这里
 * 始终安全降级，不让存储保护影响正常的历史记录采集。
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist) return false;

  try {
    if (storage.persisted && await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
