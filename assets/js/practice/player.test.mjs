import { test } from "node:test";
import assert from "node:assert/strict";

// 브라우저의 Audio를 흉내 낸다 — load() 하면 바로 재생 준비가 끝난 것처럼
class FakeAudio {
  static made = 0;
  constructor(src) {
    FakeAudio.made++;
    this.src = src;
    this.currentTime = 0;
    this.paused = true;
    this.handlers = {};
  }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  load() { setTimeout(() => this.handlers.canplaythrough?.(), 0); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}
globalThis.Audio = FakeAudio;

const { ensurePlayer } = await import("./player.js");

test("data.audio가 있으면 YouTube 대신 음성 파일 플레이어를 한 번만 만든다", async () => {
  const ctx = { data: { audio: "audio.m4a", video_id: "" } };
  const [a, b] = await Promise.all([ensurePlayer(ctx, "x"), ensurePlayer(ctx, "x")]);
  assert.equal(a, b);
  assert.equal(FakeAudio.made, 1);

  a.seekTo(3.5, true);
  assert.equal(a.getCurrentTime(), 3.5);
  a.playVideo();
  a.pauseVideo();
  assert.equal(await ensurePlayer(ctx, "x"), a);
});
