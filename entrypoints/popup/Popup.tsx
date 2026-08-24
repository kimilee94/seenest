import { useEffect, useState } from 'react';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import { getSettings, updateSettings } from '../../src/storage/settings';
import type { SeenestMessage } from '../../src/types/messages';

export function Popup() {
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [count, setCount] = useState(0);

  useEffect(() => {
    void Promise.all([getSettings(), db.history.count()]).then(([settings, historyCount]) => {
      setCaptureEnabled(settings.captureEnabled);
      setCount(historyCount);
    });
  }, []);

  const toggleCapture = async () => {
    const next = !captureEnabled;
    setCaptureEnabled(next);
    await updateSettings({ captureEnabled: next });
  };

  const openDashboard = async () => {
    const message: SeenestMessage = { type: 'SEENEST_OPEN_DASHBOARD' };
    await browser.runtime.sendMessage(message);
    window.close();
  };

  return (
    <main className="popup-shell">
      <header><Brand /><span className={`status-dot ${captureEnabled ? 'on' : ''}`} /></header>
      <section className="popup-status">
        <div><span>{captureEnabled ? '自动记录中' : '记录已暂停'}</span><strong>{count}</strong><small>条本地记录</small></div>
        <button className={`popup-switch ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? '暂停自动记录' : '开启自动记录'}><i /></button>
      </section>
      <p>仅在打开 X 帖子或文章详情时记录公开内容。</p>
      <button className="open-button" onClick={() => void openDashboard()}>打开浏览记录 <span>↗</span></button>
    </main>
  );
}
