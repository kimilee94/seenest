import type { Locale } from '../i18n';

export type ThemeMode = 'dark' | 'system' | 'light';

export interface SeenestSettings {
  captureEnabled: boolean;
  enabledSources: {
    x: boolean;
    bilibili: boolean;
  };
  theme: ThemeMode;
  locale: Locale;
}

const SETTINGS_KEY = 'seenestSettings';
export const DEFAULT_SETTINGS: SeenestSettings = {
  captureEnabled: true,
  enabledSources: { x: true, bilibili: false },
  theme: 'system',
  locale: 'zh-CN',
};

/** 判断当前代码是否运行在具有扩展存储 API 的真实浏览器扩展环境中。 */
function hasExtensionStorage(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser.storage?.local);
}

/** 读取用户设置，并用默认值补齐旧版本中尚不存在的字段。 */
export async function getSettings(): Promise<SeenestSettings> {
  if (!hasExtensionStorage()) {
    const previewSettings = localStorage.getItem(SETTINGS_KEY);
    if (!previewSettings) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(previewSettings) as Partial<SeenestSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed, enabledSources: { ...DEFAULT_SETTINGS.enabledSources, ...parsed.enabledSources } };
  }
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] as Partial<SeenestSettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...settings, enabledSources: { ...DEFAULT_SETTINGS.enabledSources, ...settings?.enabledSources } };
}

/** 合并局部设置并持久化；普通网页预览环境使用 localStorage 作为兼容回退。 */
export async function updateSettings(patch: Partial<SeenestSettings>): Promise<SeenestSettings> {
  const current = await getSettings();
  const next = {
    ...current,
    ...patch,
    enabledSources: { ...current.enabledSources, ...patch.enabledSources },
  };
  if (!hasExtensionStorage()) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
