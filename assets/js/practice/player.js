let apiReadyPromise = null;

function loadIframeApi() {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previous) previous();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => reject(new Error("YouTube IFrame API 로드 실패"));
    document.head.appendChild(tag);
    setTimeout(() => reject(new Error("YouTube IFrame API 로드 타임아웃")), 10000);
  });
  return apiReadyPromise;
}

function createPlayer(elementId, videoId) {
  return loadIframeApi().then(
    (YT) =>
      new Promise((resolve, reject) => {
        const player = new YT.Player(elementId, {
          videoId,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => resolve(player),
            onError: (e) => reject(new Error(`YouTube 재생 오류 (코드 ${e.data})`)),
          },
        });
      })
  );
}

/** ctx.player가 없으면 한 번만 만들어 캐시하고, 있으면 그대로 돌려준다. */
export async function ensurePlayer(ctx, elementId) {
  if (ctx.player) return ctx.player;
  ctx.player = await createPlayer(elementId, ctx.data.video_id);
  return ctx.player;
}

/** start~end 구간을 재생하고 end에 도달하면 멈춘 뒤 onEnd를 부른다 (100ms 폴링). */
export function playRange(player, start, end, onEnd) {
  player.seekTo(start, true);
  player.playVideo();
  const timer = setInterval(() => {
    if (player.getCurrentTime() >= end) {
      clearInterval(timer);
      player.pauseVideo();
      if (onEnd) onEnd();
    }
  }, 100);
  return () => clearInterval(timer);
}
