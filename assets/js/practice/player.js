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

/** ctx.player가 없으면 한 번만 만들어 캐시하고, 있으면 그대로 돌려준다.
 * 생성이 끝나기 전(await 중) 또 불려도 같은 in-flight Promise를 공유해, 두 번째
 * 호출이 createPlayer를 다시 실행해 YT.Player를 중복 생성하는 레이스를 막는다. */
export function ensurePlayer(ctx, elementId) {
  if (ctx.player) return Promise.resolve(ctx.player);
  ctx.playerPromise ??= createPlayer(elementId, ctx.data.video_id).then((p) => {
    ctx.player = p;
    return p;
  });
  return ctx.playerPromise;
}

// 현재 진행 중인 폴러를 취소하는 함수 — 모듈 하나에 플레이어가 하나뿐이므로
// 모듈 전역으로 추적한다.
let cancelActivePoll = null;

/** start~end 구간을 재생하고 end에 도달하면 멈춘 뒤 onEnd를 부른다 (100ms 폴링).
 * 이전 playRange 호출의 폴러가 아직 안 끝났으면 먼저 취소한다 — 안 그러면 그
 * 폴러가 자기 구간의 끝에서 멈추면서, 뒤에 걸린 새 호출의 onEnd는 영영 안 불린다. */
export function playRange(player, start, end, onEnd) {
  if (cancelActivePoll) cancelActivePoll();
  player.seekTo(start, true);
  player.playVideo();
  const timer = setInterval(() => {
    if (player.getCurrentTime() >= end) {
      clearInterval(timer);
      if (cancelActivePoll === cancel) cancelActivePoll = null;
      player.pauseVideo();
      if (onEnd) onEnd();
    }
  }, 100);
  const cancel = () => clearInterval(timer);
  cancelActivePoll = cancel;
  return cancel;
}
