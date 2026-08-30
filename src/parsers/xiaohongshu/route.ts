const NOTE_ID_PATTERN = /^[a-f0-9]{24}$/i;

export interface XiaohongshuNoteRoute {
  noteId: string;
  canonicalUrl: string;
  accessUrl: string;
}

/** 只识别笔记详情页；首页、搜索、用户主页和推荐卡片不会进入采集流程。 */
export function matchXiaohongshuNoteRoute(value: string): XiaohongshuNoteRoute | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['xiaohongshu.com', 'www.xiaohongshu.com'].includes(url.hostname.toLowerCase())) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const noteId = parts.length === 2 && parts[0] === 'explore'
    ? parts[1] ?? ''
    : parts.length === 3 && parts[0] === 'discovery' && parts[1] === 'item'
      ? parts[2] ?? '' : '';
  if (!NOTE_ID_PATTERN.test(noteId)) return null;
  const canonicalUrl = `https://www.xiaohongshu.com/explore/${noteId}`;
  url.hash = '';
  return {
    noteId,
    canonicalUrl,
    // 小红书详情回访可能依赖 xsec_token / xsec_source，保留用户实际打开的完整地址。
    accessUrl: url.href,
  };
}
