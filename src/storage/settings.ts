import type { Locale } from '../i18n';

export type ThemeMode = 'dark' | 'system' | 'light';

export interface SeenestSettings {
  captureEnabled: boolean;
  enabledSources: {
    x: boolean;
    bilibili: boolean;
    github: boolean;
    youtube: boolean;
    xiaohongshu: boolean;
  };
  theme: ThemeMode;
  locale: Locale;
}

const SETTINGS_KEY = 'seenestSettings';
const PREVIEW_SETTINGS_EVENT = 'seenest:settings-change';

/** 首次使用时读取浏览器界面语言；当前只提供中文和英文两套预置界面。 */
export function detectPreferredLocale(language = typeof navigator !== 'undefined' ? navigator.language : 'en'): Locale {
  return /^zh(?:-|$)/i.test(language) ? 'zh-CN' : 'en';
}

export const DEFAULT_SETTINGS: SeenestSettings = {
  captureEnabled: true,
  enabledSources: { x: true, bilibili: false, github: false, youtube: false, xiaohongshu: false },
  theme: 'system',
  locale: detectPreferredLocale(),
};

/** 判断当前代码是否运行在具有扩展存储 API 的真实浏览器扩展环境中。 */
function hasExtensionStorage(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser.storage?.local);
}

/** 读取用户设置；已保存语言始终优先，缺失时才使用浏览器语言生成的默认值。 */
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
    window.dispatchEvent(new CustomEvent<SeenestSettings>(PREVIEW_SETTINGS_EVENT, { detail: next }));
    return next;
  }
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * 监听弹窗、管理页及内容脚本对同一份设置的修改。
 * 返回清理函数，避免 React 页面重复挂载后留下多个监听器。
 */
export function subscribeSettings(listener: (settings: SeenestSettings) => void): () => void {
  if (!hasExtensionStorage()) {
    const handlePreviewChange = (event: Event) => listener((event as CustomEvent<SeenestSettings>).detail);
    window.addEventListener(PREVIEW_SETTINGS_EVENT, handlePreviewChange);
    return () => window.removeEventListener(PREVIEW_SETTINGS_EVENT, handlePreviewChange);
  }

  const handleExtensionChange = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    // 统一重新读取并补齐旧版本字段，避免直接使用不完整的 storage change 数据。
    void getSettings().then(listener).catch(() => {
      // 扩展重新加载后旧页面上下文会失效；设置同步静默结束，等待页面刷新载入新版本。
    });
  };
  browser.storage.onChanged.addListener(handleExtensionChange);
  return () => browser.storage.onChanged.removeListener(handleExtensionChange);
}
