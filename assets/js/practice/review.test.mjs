import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewState, isWeak } from "./review.js";

const good = { stage1: { understood: 4, total: 4 }, stage3: { questionScore: 4, questionTotal: 4, dictationAccuracy: 0.9 } };

test("기록이 없으면 복습 상태도 없다", () => {
  assert.equal(reviewState([], "2026-10-05"), null);
});

test("처음 연습한 날의 다음 날이 첫 복습일이다", () => {
  const s = reviewState([{ date: "2026-10-05", ...good }], "2026-10-05");
  assert.equal(s.due, "2026-10-06");
  assert.equal(s.days, 1);
  assert.equal(s.isDue, false);
  assert.equal(s.practicedToday, true);
});

test("연습한 날이 쌓일수록 간격이 1·2·4일로 넓어진다", () => {
  const a = [{ date: "2026-10-01", ...good }, { date: "2026-10-02", ...good }, { date: "2026-10-04", ...good }];
  const s = reviewState(a, "2026-10-05");
  assert.equal(s.due, "2026-10-08"); // 세 번째 날 이후 4일
  assert.equal(s.isDue, false);
});

test("같은 날 여러 번 해도 하루로 센다", () => {
  const a = [{ date: "2026-10-01", ...good }, { date: "2026-10-01", ...good }];
  assert.equal(reviewState(a, "2026-10-01").due, "2026-10-02");
});

test("복습일이 지나면 isDue이고 days는 음수다", () => {
  const s = reviewState([{ date: "2026-10-01", ...good }], "2026-10-05");
  assert.equal(s.isDue, true);
  assert.equal(s.days, -3);
});

test("약했던 연습은 다음 날 다시 — 간격이 1일로 돌아간다", () => {
  const weak = { date: "2026-10-04", stage1: { understood: 1, total: 4 } };
  const a = [{ date: "2026-10-01", ...good }, { date: "2026-10-02", ...good }, weak];
  assert.equal(isWeak(weak), true);
  assert.equal(reviewState(a, "2026-10-04").due, "2026-10-05");
});

test("월말을 넘어도 날짜를 바르게 더한다", () => {
  assert.equal(reviewState([{ date: "2026-10-31", ...good }], "2026-10-31").due, "2026-11-01");
});
