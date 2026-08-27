import { useEffect, useState } from 'react';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import { translate, type Locale } from '../../src/i18n';
import { getSettings, updateSettings } from '../../src/storage/settings';
import { applyLocale, applyTheme } from '../../src/theme/apply-theme';
import type { SeenestMessage } from '../../src/types/messages';

/** 插件弹窗：快速查看记录数量、切换采集状态并进入完整时光机。 */
export function Popup() {
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [count, setCount] = useState(0);
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(locale, key, values);

  // 弹窗打开时并行读取开关设置和本地记录总数，减少等待时间。
  useEffect(() => {
    void Promise.all([getSettings(), db.history.count()]).then(([settings, historyCount]) => {
      setCaptureEnabled(settings.captureEnabled);
      setLocale(settings.locale);
      setCount(historyCount);
      applyTheme(settings.theme);
      applyLocale(settings.locale);
    });
  }, []);

  /** 切换自动记录状态并立即写入扩展本地设置。 */
  const toggleCapture = async () => {
    const next = !captureEnabled;
    setCaptureEnabled(next);
    await updateSettings({ captureEnabled: next });
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
