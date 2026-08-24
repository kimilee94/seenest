export interface SeenestSettings {
  captureEnabled: boolean;
}

const SETTINGS_KEY = 'seenestSettings';
export const DEFAULT_SETTINGS: SeenestSettings = { captureEnabled: true };

function hasExtensionStorage(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser.storage?.local);
}

export async function getSettings(): Promise<SeenestSettings> {
  if (!hasExtensionStorage()) {
    const previewSettings = localStorage.getItem(SETTINGS_KEY);
    return previewSettings ? { ...DEFAULT_SETTINGS, ...JSON.parse(previewSettings) } : DEFAULT_SETTINGS;
  }
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<SeenestSettings> | undefined) };
}

export async function updateSettings(patch: Partial<SeenestSettings>): Promise<SeenestSettings> {
  const next = { ...(await getSettings()), ...patch };
  if (!hasExtensionStorage()) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
