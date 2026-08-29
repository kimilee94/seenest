import { useEffect, useState } from 'react';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import { translate, type Locale } from '../../src/i18n';
import { getSettings, subscribeSettings, updateSettings } from '../../src/storage/settings';
import { applyLocale, applyTheme } from '../../src/theme/apply-theme';
import type { SeenestMessage } from '../../src/types/messages';

/** 插件弹窗：快速查看已收好内容的数量、切换收录状态并进入 Seenest。 */
export function Popup() {
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [count, setCount] = useState(0);
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);

  // 弹窗打开时并行读取开关设置和本地记录总数，减少等待时间。
  useEffect(() => {
    const applySettings = (settings: Awaited<ReturnType<typeof getSettings>>) => {
      setCaptureEnabled(settings.captureEnabled);
      setLocale(settings.locale);
      applyTheme(settings.theme);
      applyLocale(settings.locale);
    };
    void Promise.all([getSettings(), db.history.count()]).then(([settings, historyCount]) => {
      applySettings(settings);
      setCount(historyCount);
    }).catch(() => {
      // 弹窗关闭或扩展更新时页面上下文可能先于读取任务销毁，无需继续更新 UI。
    });
    return subscribeSettings(applySettings);
  }, []);

  /** 切换自动记录状态并立即写入扩展本地设置。 */
  const toggleCapture = async () => {
    const next = !captureEnabled;
    setCaptureEnabled(next);
    const current = await getSettings();
    const hasEnabledSource = Object.values(current.enabledSources).some(Boolean);
    await updateSettings({
      captureEnabled: next,
      // 如果用户曾关闭全部来源，再次启动时默认恢复 X，避免出现“运行中但没有可记录网站”。
      enabledSources: next && !hasEnabledSource
        ? { ...current.enabledSources, x: true }
        : current.enabledSources,
    });
  };

  /** 通知后台打开完整管理页面，随后关闭当前小弹窗。 */
  const openDashboard = async () => {
    const message: SeenestMessage = { type: 'SEENEST_OPEN_DASHBOARD' };
    await browser.runtime.sendMessage(message);
    window.close();
  };

  return (
    <main className="popup-shell">
      <header><Brand label={t('brand.home')} /><span className={`status-dot ${captureEnabled ? 'on' : ''}`} /></header>
      <section className="popup-status">
        <div><span>{captureEnabled ? t('status.running') : t('status.paused')}</span><strong>{count}</strong><small>{t('popup.savedCount')}</small></div>
        <button className={`popup-switch ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? t('capture.pause') : t('capture.enable')}><i /></button>
      </section>
      <p>{t('popup.description')}</p>
      <button className="open-button" onClick={() => void openDashboard()}>{t('popup.open')} <span>↗</span></button>
    </main>
  );
}
