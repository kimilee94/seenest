export interface BilibiliVideoRoute {
  bvid: string;
}

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

/** 只接受哔哩哔哩标准视频详情页，推荐页、动态页和个人空间不会触发记录。 */
export function matchBilibiliVideoRoute(inputUrl: string): BilibiliVideoRoute | null {
  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    return null;
  }
  if (!['bilibili.com', 'www.bilibili.com'].includes(url.hostname)) return null;
  const bvid = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1] ?? '';
  return BVID_PATTERN.test(bvid) ? { bvid } : null;
}

/** 去掉 spm、vd_source 等跟踪参数，只保留可以长期打开的规范视频链接。 */
export function canonicalizeBilibiliVideoUrl(bvid: string): string {
  return `https://www.bilibili.com/video/${bvid}/`;
}

export function isValidBvid(value: string): boolean {
  return BVID_PATTERN.test(value);
}
