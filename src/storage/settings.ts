export interface SeenestSettings {
  captureEnabled: boolean;
}

const SETTINGS_KEY = 'seenestSettings';
export const DEFAULT_SETTINGS: SeenestSettings = { captureEnabled: true };

/** 判断当前代码是否运行在具有扩展存储 API 的真实浏览器扩展环境中。 */
function hasExtensionStorage(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser.storage?.local);
}

/** 读取用户设置，并用默认值补齐旧版本中尚不存在的字段。 */
export async function getSettings(): Promise<SeenestSettings> {
  if (!hasExtensionStorage()) {
    const previewSettings = localStorage.getItem(SETTINGS_KEY);
    return previewSettings ? { ...DEFAULT_SETTINGS, ...JSON.parse(previewSettings) } : DEFAULT_SETTINGS;
  }
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<SeenestSettings> | undefined) };
}

/** 合并局部设置并持久化；普通网页预览环境使用 localStorage 作为兼容回退。 */
export async function updateSettings(patch: Partial<SeenestSettings>): Promise<SeenestSettings> {
  const next = { ...(await getSettings()), ...patch };
  if (!hasExtensionStorage()) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
