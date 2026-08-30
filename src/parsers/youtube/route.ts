const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export interface YoutubeVideoRoute {
  videoId: string;
}

/** 只识别标准视频详情页，首页、搜索、频道和其他页面均拒绝采集。 */
export function matchYoutubeVideoRoute(value: string): YoutubeVideoRoute | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['youtube.com', 'www.youtube.com'].includes(url.hostname.toLowerCase())) return null;

  if (url.pathname === '/watch') {
    const videoId = url.searchParams.get('v') ?? '';
    return VIDEO_ID_PATTERN.test(videoId) ? { videoId } : null;
  }
  return null;
}

/** 去除播放列表、播放进度和分享追踪参数，统一为标准视频链接。 */
export function canonicalizeYoutubeVideoUrl(route: YoutubeVideoRoute): string {
  return `https://www.youtube.com/watch?v=${route.videoId}`;
}
