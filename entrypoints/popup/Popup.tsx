import { useEffect, useState } from 'react';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import { getSettings, updateSettings } from '../../src/storage/settings';
import type { SeenestMessage } from '../../src/types/messages';

/** 插件弹窗：快速查看记录数量、切换采集状态并进入完整时光机。 */
export function Popup() {
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [count, setCount] = useState(0);

  // 弹窗打开时并行读取开关设置和本地记录总数，减少等待时间。
  useEffect(() => {
    void Promise.all([getSettings(), db.history.count()]).then(([settings, historyCount]) => {
      setCaptureEnabled(settings.captureEnabled);
      setCount(historyCount);
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
      <header><Brand /><span className={`status-dot ${captureEnabled ? 'on' : ''}`} /></header>
      <section className="popup-status">
        <div><span>{captureEnabled ? '时光机运行中' : '时光机已暂停'}</span><strong>{count}</strong><small>条记录已留住</small></div>
        <button className={`popup-switch ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? '暂停自动记录' : '开启自动记录'}><i /></button>
      </section>
      <p>每次打开 X 帖子或文章，都会安静地留在本机。</p>
      <button className="open-button" onClick={() => void openDashboard()}>打开时光机 <span>↗</span></button>
    </main>
  );
}
