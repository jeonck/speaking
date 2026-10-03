import { ensurePlayer, playRange } from "./player.js";

// 페이지에 하나뿐인 (숨겨진) YouTube 플레이어 자리 — stages.js가 단계 패널 밖에 만든다
export const PLAYER_ID = "pr-yt";

// 지금 재생 중인 버튼 — 플레이어가 하나라 재생도 한 번에 하나뿐이다
let active = null;

/**
 * 재생 버튼 하나를 토글한다: 멈춰 있으면 구간을 재생하며 버튼을 "■ 정지"로 바꾸고
 * (row가 있으면 그 문장을 강조), 재생 중에 다시 누르면 멈춘다. 다른 버튼이 재생을
 * 시작하면 이전 버튼은 자동으로 원래 모습으로 돌아온다.
 * onEnd(completed)는 구간을 끝까지 들었는지와 함께 한 번 불린다.
 * 플레이어를 못 불러오면 예외를 던진다 — 호출한 쪽이 안내를 보여준다.
 */
export async function togglePlay(ctx, btn, { start, end, row, onEnd } = {}) {
  if (active && active.btn === btn) {
    active.stop();
    return;
  }
  const label = btn.innerHTML;
  btn.disabled = true;
  let player;
  try {
    player = await ensurePlayer(ctx, PLAYER_ID);
  } finally {
    btn.disabled = false;
  }

  btn.classList.add("is-playing");
  btn.setAttribute("aria-pressed", "true");
  // 문장 옆 동그란 버튼은 아이콘만, 나머지는 글자까지
  btn.innerHTML = btn.classList.contains("pr-btn--play") ? "■" : "■ 정지";
  if (row) row.classList.add("is-playing");

  const entry = { btn };
  const cancel = playRange(player, start, end, (completed) => {
    btn.classList.remove("is-playing");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = label;
    if (row) row.classList.remove("is-playing");
    if (active === entry) active = null;
    if (onEnd) onEnd(completed);
  });
  entry.stop = () => {
    player.pauseVideo();
    cancel();
  };
  active = entry;
}

/** 지금 재생 중인 소리가 있으면 멈춘다 (단계를 옮길 때). */
export function stopPlayback() {
  if (active) active.stop();
}
