import { describe, expect, it } from 'vitest';
import { createHistorySheetData } from '../src/export/excel';
import { parseXDetail } from '../src/parsers/x/parser';
import { matchXDetailRoute } from '../src/parsers/x/route';

describe('matchXDetailRoute', () => {
  it('only accepts X detail routes', () => {
    expect(matchXDetailRoute('https://x.com/seenest/status/12345')).toEqual({ kind: 'status', handle: 'seenest', id: '12345' });
    expect(matchXDetailRoute('https://x.com/home')).toBeNull();
    expect(matchXDetailRoute('https://example.com/seenest/status/12345')).toBeNull();
  });
});

describe('parseXDetail', () => {
  it('extracts a public post and its author avatar', () => {
    document.body.innerHTML = `
      <main>
        <article>
          <div data-testid="User-Name"><span>Lin Chen</span><span>@linbuilds</span><span> · 2小时</span></div>
          <img src="https://pbs.twimg.com/profile_images/123/avatar_normal.jpg" />
          <a href="/linbuilds/status/12345"><time datetime="2026-08-23T01:42:00.000Z"></time></a>
          <div data-testid="tweetText">Agent 真正的价值，是压缩从想法到验证的距离。</div>
        </article>
      </main>`;

    const record = parseXDetail(document, 'https://x.com/linbuilds/status/12345?s=20', new Date('2026-08-23T08:28:00.000Z'));
    expect(record).toMatchObject({
      id: 'x:status:12345',
      authorName: 'Lin Chen',
      authorHandle: '@linbuilds',
      authorAvatarUrl: 'https://pbs.twimg.com/profile_images/123/avatar_normal.jpg',
      contentType: 'post',
      publishedAt: '2026-08-23T01:42:00.000Z',
      canonicalUrl: 'https://x.com/linbuilds/status/12345',
    });
  });

  it('extracts a long-form X article', () => {
    document.body.innerHTML = `
      <main>
        <div data-testid="User-Name"><span>Maya</span><span>@mayamakes</span></div>
        <img src="https://pbs.twimg.com/profile_images/456/avatar_normal.jpg" />
        <time datetime="2026-08-22T14:18:00.000Z"></time>
        <div data-testid="twitterArticleReadView">
          <h1>我们如何把需求拆成两周内可验证的产品</h1>
          <p>从用户访谈开始建立任务模型。</p>
          <p>随后完成第一个可用原型。</p>
        </div>
      </main>`;

    const record = parseXDetail(document, 'https://x.com/i/article/98765', new Date('2026-08-23T06:06:00.000Z'));
    expect(record).toMatchObject({
      id: 'x:article:98765',
      contentType: 'article',
      title: '我们如何把需求拆成两周内可验证的产品',
      contentText: '从用户访谈开始建立任务模型。 随后完成第一个可用原型。',
      authorName: 'Maya',
      authorHandle: '@mayamakes',
      canonicalUrl: 'https://x.com/i/article/98765',
    });
  });

  it('extracts an X article card opened through a status URL', () => {
    document.body.innerHTML = `
      <main>
        <article>
          <div data-testid="User-Name"><span>Kimi Lee</span><span>@kimileexi</span></div>
          <img src="https://pbs.twimg.com/profile_images/789/avatar_normal.jpg" />
          <a href="/kimileexi/status/2091370897072595262"><time datetime="2026-08-23T10:00:00.000Z"></time></a>
          <div data-testid="card.wrapper">
            <a href="/i/article/2091364268830867456">
              <div dir="auto">浏览器自动记录工具的设计复盘</div>
              <div dir="auto">如何在保护隐私的前提下保存阅读历史。</div>
            </a>
          </div>
        </article>
      </main>`;

    const record = parseXDetail(
      document,
      'https://x.com/kimileexi/status/2091370897072595262',
      new Date('2026-08-23T12:00:00.000Z'),
    );
    expect(record).toMatchObject({
      id: 'x:status:2091370897072595262',
      contentType: 'article',
      title: '浏览器自动记录工具的设计复盘',
      contentText: '浏览器自动记录工具的设计复盘 如何在保护隐私的前提下保存阅读历史。',
      authorName: 'Kimi Lee',
      authorHandle: '@kimileexi',
    });
  });
});

describe('createHistorySheetData', () => {
  it('creates an Excel header and one row per history record', () => {
    const data = createHistorySheetData([{
      id: 'x:status:1',
      source: 'x',
      contentType: 'post',
      url: 'https://x.com/seenest/status/1',
      canonicalUrl: 'https://x.com/seenest/status/1',
      postId: '1',
      title: '测试帖子',
      contentText: '测试正文',
      authorName: 'Seenest',
      authorHandle: '@seenest',
      authorAvatarUrl: '',
      publishedAt: null,
      firstVisitedAt: '2026-08-23T10:00:00.000Z',
      lastVisitedAt: '2026-08-23T10:00:00.000Z',
      visitCount: 1,
      parserVersion: 2,
    }]);

    expect(data).toHaveLength(2);
    expect(data[0]).toHaveLength(10);
    expect(data[1]?.[0]).toBe('帖子');
    expect(data[1]?.[8]).toBe(1);
  });
});
