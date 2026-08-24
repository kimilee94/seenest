import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brand } from '../../src/components/Brand';
import { db } from '../../src/db/database';
import { clearHistory, exportHistory, importHistory } from '../../src/db/history-repository';
import { exportHistoryExcel } from '../../src/export/excel';
import { getSettings, updateSettings } from '../../src/storage/settings';
import type { ExportPayload, HistoryRecord } from '../../src/types/history';
import { dayDistance, formatDate, formatPublishedAt, formatTime, localDateKey, relativeDayLabel } from '../../src/utils/date';

type View = 'history' | 'permissions' | 'data';
type TimeFilter = 'all' | 'today' | 'yesterday' | 'week';

function downloadJson(payload: ExportPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `seenest-backup-${localDateKey(new Date())}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Avatar({ record }: { record: HistoryRecord }) {
  const [failed, setFailed] = useState(false);
  const initials = (record.authorName || record.authorHandle || 'X').slice(0, 1).toUpperCase();
  return (
    <span className="avatar-shell" aria-label={`${record.authorName} 的头像`}>
      <span>{initials}</span>
      {record.authorAvatarUrl && !failed ? (
        <img className="author-avatar" src={record.authorAvatarUrl} alt="" width="36" height="36" onError={() => setFailed(true)} />
      ) : null}
    </span>
  );
}

function HistoryRow({ record }: { record: HistoryRecord }) {
  return (
    <article className="history-row">
      <Avatar record={record} />
      <div className="history-content">
        <div className="title-line">
          <a href={record.url} target="_blank" rel="noreferrer">{record.title}</a>
          <span className="type-badge">{record.contentType === 'article' ? '文章' : '帖子'}</span>
        </div>
        <p>{record.contentText}</p>
        <div className="item-meta">
          <strong>{record.authorName}</strong>
          {record.authorHandle ? <span>{record.authorHandle}</span> : null}
          <i />
          <span>{formatPublishedAt(record.publishedAt)}</span>
          {record.visitCount > 1 ? <><i /><span>访问 {record.visitCount} 次</span></> : null}
        </div>
      </div>
      <div className="visit-info">
        <strong>{dayDistance(record.lastVisitedAt) < 2 ? formatTime(record.lastVisitedAt) : formatDate(record.lastVisitedAt)}</strong>
        <span>{dayDistance(record.lastVisitedAt) < 2 ? '访问时间' : '访问日期'}</span>
        <a href={record.url} target="_blank" rel="noreferrer" aria-label="打开原文">↗</a>
      </div>
    </article>
  );
}

function Header({ view, setView, captureEnabled, onExportExcel }: {
  view: View;
  setView: (view: View) => void;
  captureEnabled: boolean;
  onExportExcel: () => void;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand-button" onClick={() => setView('history')}><Brand /></button>
        <nav className="header-nav" aria-label="页面导航">
          <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>浏览记录</button>
          <button className={view === 'permissions' ? 'active' : ''} onClick={() => setView('permissions')}>网站权限</button>
          <button className={view === 'data' ? 'active' : ''} onClick={() => setView('data')}>数据管理</button>
        </nav>
        <div className="header-actions">
          <span className={`recording-state ${captureEnabled ? '' : 'paused'}`}><i /><span>{captureEnabled ? '自动记录中' : '记录已暂停'}</span></span>
          <button className="export-button" type="button" onClick={onExportExcel}>导出 Excel</button>
          <button className="settings-button" type="button" aria-label="打开数据管理" onClick={() => setView('data')}>⚙</button>
        </div>
      </div>
    </header>
  );
}

function EmptyState({ filtered, onReset }: { filtered: boolean; onReset: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-search" />
      <h3>{filtered ? '没有找到相关记录' : '还没有浏览记录'}</h3>
      <p>{filtered ? '换一个关键词，或者查看全部时间。' : '打开一条 X 帖子或文章详情，Seenest 会自动记录在这里。'}</p>
      {filtered ? <button type="button" onClick={onReset}>清除筛选</button> : <a className="empty-link" href="https://x.com/home" target="_blank" rel="noreferrer">打开 X</a>}
    </div>
  );
}

export function App() {
  const records = useLiveQuery(() => db.history.orderBy('lastVisitedAt').reverse().toArray(), [], []);
  const [view, setView] = useState<View>('history');
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [query, setQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [newestFirst, setNewestFirst] = useState(true);
  const [notice, setNotice] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void getSettings().then((settings) => setCaptureEnabled(settings.captureEnabled)); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('#history-search')?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = records.filter((record) => {
      const distance = dayDistance(record.lastVisitedAt);
      const matchesTime = timeFilter === 'all' || (timeFilter === 'today' && distance === 0) ||
        (timeFilter === 'yesterday' && distance === 1) || (timeFilter === 'week' && distance >= 0 && distance < 7);
      const searchable = `${record.title} ${record.contentText} ${record.authorName} ${record.authorHandle} ${record.url}`.toLocaleLowerCase();
      return matchesTime && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
    return newestFirst ? filtered : [...filtered].reverse();
  }, [records, query, timeFilter, newestFirst]);

  const groups = useMemo(() => {
    const map = new Map<string, HistoryRecord[]>();
    for (const record of visibleRecords) {
      const key = localDateKey(record.lastVisitedAt);
      const group = map.get(key) ?? [];
      group.push(record);
      map.set(key, group);
    }
    return [...map.entries()];
  }, [visibleRecords]);

  const todayCount = records.filter((record) => dayDistance(record.firstVisitedAt) === 0).length;
  const recentDates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const key = localDateKey(record.lastVisitedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)).slice(0, 4);
  }, [records]);

  const toggleCapture = async () => {
    const next = !captureEnabled;
    setCaptureEnabled(next);
    await updateSettings({ captureEnabled: next });
  };

  const handleExport = async () => {
    downloadJson(await exportHistory());
    setNotice('记录已导出');
  };

  const handleExportExcel = async () => {
    await exportHistoryExcel(records);
    setNotice('Excel 表格已导出');
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as ExportPayload;
      const count = await importHistory(payload);
      setNotice(`已导入 ${count} 条记录`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入失败');
    } finally {
      event.target.value = '';
    }
  };

  const handleClear = async () => {
    if (!window.confirm('确定清除全部本地浏览记录吗？此操作无法撤销。')) return;
    await clearHistory();
    setNotice('全部记录已清除');
  };

  const resetFilters = () => { setQuery(''); setTimeFilter('all'); };

  return (
    <main className="page-shell">
      <Header view={view} setView={setView} captureEnabled={captureEnabled} onExportExcel={() => void handleExportExcel()} />
      {notice ? <button className="toast" onClick={() => setNotice('')}>{notice}</button> : null}

      {view === 'history' ? (
        <>
          <section className="search-zone">
            <div className="search-inner">
              <div className="search-copy"><h1>找回你在 X 上看过的内容</h1><p>打开帖子或文章详情后，Seenest 会自动记录公开内容和原始链接。</p></div>
              <label className="search-box"><span className="search-icon" /><input id="history-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、作者或链接" /><kbd>⌘ K</kbd></label>
              <div className="quick-filters" role="group" aria-label="时间筛选">
                <span className="source-chip"><b>X</b> X / Twitter</span>
                {([['all', '全部记录'], ['today', '今天'], ['yesterday', '昨天'], ['week', '最近 7 天']] as const).map(([key, label]) => (
                  <button key={key} className={timeFilter === key ? 'selected' : ''} onClick={() => setTimeFilter(key)}>{label}</button>
                ))}
              </div>
            </div>
          </section>

          <div className="content-area">
            <section className="history-panel">
              <div className="panel-head"><div><h2>浏览记录</h2><span>共 {records.length} 条，全部保存在本机</span></div><button className="sort-control" onClick={() => setNewestFirst((value) => !value)}>{newestFirst ? '最近访问' : '最早访问'} <span>⌄</span></button></div>
              {groups.length ? <div className="history-groups">{groups.map(([date, items]) => (
                <section className="history-group" key={date}>
                  <div className="date-divider"><strong>{relativeDayLabel(items[0]!.lastVisitedAt)}</strong><span>{formatDate(items[0]!.lastVisitedAt)}</span><i /><small>{items.length} 条</small></div>
                  <div className="history-list">{items.map((record) => <HistoryRow key={record.id} record={record} />)}</div>
                </section>
              ))}</div> : <EmptyState filtered={Boolean(query || timeFilter !== 'all')} onReset={resetFilters} />}
            </section>

            <aside className="side-column">
              <section className="side-card status-card">
                <div className="side-card-head"><h3>记录状态</h3><span className={captureEnabled ? 'live-dot' : 'idle-dot'} /></div>
                <div className="source-row"><span className="x-logo">X</span><div><strong>X / Twitter</strong><small>已授权访问 x.com</small></div><button className={`switch ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? '暂停自动记录' : '开启自动记录'}><i /></button></div>
                <div className="capture-rule"><span>✓</span><p><strong>仅记录详情页面</strong>不会记录首页信息流、私信或其他网站。</p></div>
                <div className="capture-fields"><span>自动保存</span><p>原始链接 · 正文 · 发布人 · 发布时间 · 访问时间</p></div>
              </section>
              <section className="side-card data-card"><div className="side-card-head"><h3>本地数据</h3><button onClick={() => setView('data')}>管理</button></div><div className="data-grid"><div><strong>{records.length}</strong><span>全部记录</span></div><div><strong>{todayCount}</strong><span>今天新增</span></div></div><div className="local-note"><span>⌂</span><p><strong>数据仅在此设备</strong><small>未上传到任何服务器</small></p></div></section>
              <section className="side-card dates-card"><div className="side-card-head"><h3>最近日期</h3><button onClick={() => setTimeFilter('all')}>全部</button></div>{recentDates.length ? recentDates.map(([date, count]) => <button className="date-row" key={date} onClick={() => { setQuery(''); setTimeFilter(date === localDateKey(new Date()) ? 'today' : 'week'); }}><span><strong>{relativeDayLabel(`${date}T12:00:00`)}</strong><small>{formatDate(`${date}T12:00:00`)}</small></span><b>{count}</b></button>) : <p className="side-empty">暂无日期数据</p>}</section>
            </aside>
          </div>
        </>
      ) : null}

      {view === 'permissions' ? (
        <section className="settings-page"><div className="settings-heading"><span>网站权限</span><h1>选择 Seenest 可以记录的网站</h1><p>当前版本只支持 X。暂停后，已保存的记录不会被删除。</p></div><div className="settings-card"><div className="permission-logo">X</div><div className="permission-copy"><strong>X / Twitter</strong><span>仅在帖子和文章详情页面读取公开内容</span><code>https://x.com/*</code></div><button className={`switch large ${captureEnabled ? 'on' : ''}`} onClick={() => void toggleCapture()} aria-label={captureEnabled ? '暂停自动记录' : '开启自动记录'}><i /></button></div><div className="privacy-card"><strong>最小权限原则</strong><p>Seenest 不读取首页信息流、私信、Cookie、登录信息或其他网站。后续新增网站时，会先向你请求单独授权。</p></div></section>
      ) : null}

      {view === 'data' ? (
        <section className="settings-page"><div className="settings-heading"><span>数据管理</span><h1>你的记录始终由你掌握</h1><p>可以导出 Excel 表格或 JSON 备份，也可以随时导入和清除本地数据。</p></div><div className="data-actions"><article><span className="action-icon">▦</span><div><strong>导出 Excel 表格</strong><p>生成可用 Excel、Numbers 或 WPS 打开的 .xlsx 浏览记录表格。</p></div><button onClick={() => void handleExportExcel()}>导出 Excel</button></article><article><span className="action-icon">⇩</span><div><strong>导出 JSON 备份</strong><p>生成用于迁移和恢复 Seenest 数据的完整 JSON 备份。</p></div><button onClick={() => void handleExport()}>导出 JSON</button></article><article><span className="action-icon">⇧</span><div><strong>导入备份</strong><p>导入已有 JSON 备份；相同记录会合并，不会重复创建。</p></div><button onClick={() => importRef.current?.click()}>选择文件</button><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(event) => void handleImport(event)} /></article><article className="danger"><span className="action-icon">×</span><div><strong>清除全部记录</strong><p>删除当前设备中的 {records.length} 条浏览记录，无法撤销。</p></div><button onClick={() => void handleClear()} disabled={!records.length}>清除数据</button></article></div></section>
      ) : null}
    </main>
  );
}
