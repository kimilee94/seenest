import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../entrypoints/dashboard/App';
import '../entrypoints/dashboard/styles.css';
import { db } from '../src/db/database';
import type { HistoryRecord } from '../src/types/history';

const REAL_PREVIEW_AVATAR = 'https://pbs.twimg.com/profile_images/2089912170226286592/hNAxM0DA_400x400.jpg';

/** 生成不依赖网络的演示头像，用于本地预览圆形头像与悬停旋转效果。 */
function demoAvatar(initials: string, from: string, to: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><text x="48" y="58" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="31" font-weight="700">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** 首次打开预览页时写入两条独立的演示数据，不会进入真实扩展数据库。 */
async function seedPreviewHistory(): Promise<void> {
  const now = Date.now();
  const records: HistoryRecord[] = [
    {
      id: 'preview:status:1', source: 'x', contentType: 'post', postId: '1',
      url: 'https://x.com/seenest/status/1', canonicalUrl: 'https://x.com/seenest/status/1',
      title: '给浏览过的精彩内容，留一张不会消失的车票',
      contentText: 'Seenest 会在打开帖子详情时自动留下正文、作者、发布时间与互动数据，所有记忆都保存在本机。',
      authorName: 'Seenest', authorHandle: '@seenest', authorAvatarUrl: demoAvatar('S', '#247cf2', '#8057e8'),
      publishedAt: new Date(now - 42 * 60_000).toISOString(), firstVisitedAt: new Date(now - 18 * 60_000).toISOString(),
      lastVisitedAt: new Date(now - 18 * 60_000).toISOString(), visitCount: 1, parserVersion: 3,
      replyCount: 36, repostCount: 128, viewCount: 286_000, bookmarkCount: 517, likeCount: 2_431,
    },
    {
      id: 'preview:status:2', source: 'x', contentType: 'article', postId: '2',
      url: 'https://x.com/miora/status/2', canonicalUrl: 'https://x.com/miora/status/2',
      title: 'Local-first 浏览记录：如何把隐私和可靠性同时做好',
      contentText: '从最小权限、去重采集到 IndexedDB 与自动 JSON 快照，一次完整的本地优先设计实践。',
      authorName: 'Miora', authorHandle: '@miora_notes', authorAvatarUrl: REAL_PREVIEW_AVATAR,
      publishedAt: new Date(now - 26 * 60 * 60_000).toISOString(), firstVisitedAt: new Date(now - 25 * 60 * 60_000).toISOString(),
      lastVisitedAt: new Date(now - 25 * 60 * 60_000).toISOString(), visitCount: 2, parserVersion: 3,
      replyCount: 18, repostCount: 64, viewCount: 78_500, bookmarkCount: 309, likeCount: 1_206,
    },
  ];
  // 额外生成分页演示记录，让预览页可以直接检查第二页和分页边界。
  const pageRecords: HistoryRecord[] = Array.from({ length: 22 }, (_, offset) => {
    const index = offset + 3;
    const visitedAt = new Date(now - index * 3 * 60 * 60_000).toISOString();
    return {
      id: `preview:status:${index}`,
      source: 'x',
      contentType: index % 4 === 0 ? 'article' : 'post',
      postId: String(index),
      url: `https://x.com/seenest/status/${index}`,
      canonicalUrl: `https://x.com/seenest/status/${index}`,
      title: index % 4 === 0 ? `第 ${index} 段时光：一篇值得重新阅读的长文章` : `第 ${index} 条自动留下的 X 浏览记录`,
      contentText: '这是用于检查来源筛选、日期分组和分页边界的本地演示内容，不会上传到任何服务器。',
      authorName: index % 2 === 0 ? 'Seenest' : 'Miora',
      authorHandle: index % 2 === 0 ? '@seenest' : '@miora_notes',
      authorAvatarUrl: index % 2 === 0 ? demoAvatar('S', '#247cf2', '#8057e8') : REAL_PREVIEW_AVATAR,
      publishedAt: new Date(Date.parse(visitedAt) - 45 * 60_000).toISOString(),
      firstVisitedAt: visitedAt,
      lastVisitedAt: visitedAt,
      visitCount: index % 3 === 0 ? 2 : 1,
      parserVersion: 3,
      replyCount: index * 2,
      repostCount: index * 5,
      viewCount: index * 12_800,
      bookmarkCount: index * 8,
      likeCount: index * 31,
    };
  });
  await db.history.bulkPut([...records, ...pageRecords]);
}

await seedPreviewHistory();

const root = document.getElementById('root');
if (!root) throw new Error('找不到预览页面根节点');
createRoot(root).render(<StrictMode><App /></StrictMode>);
