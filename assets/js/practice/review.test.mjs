import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewState, isWeak, attemptScore, recommendLevel, streakDays } from "./review.js";

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

test("attemptScore는 있는 결과만 평균한다", () => {
  assert.equal(attemptScore({ stage1: { understood: 3, total: 4 } }), 0.75);
  assert.equal(attemptScore({}), null);
});

test("같은 레벨 최근 평균이 80% 이상이면 한 단계 위를 권한다", () => {
  const r = recommendLevel([{ level: 1, score: 0.9 }, { level: 1, score: 0.85 }, { level: 2, score: 0.4 }]);
  assert.deepEqual([r.level, r.move], [2, "up"]);
});

test("60% 미만이면 한 단계 아래, 한 번만 해 봤으면 아직 판단하지 않는다", () => {
  assert.deepEqual(recommendLevel([{ level: 3, score: 0.5 }, { level: 3, score: 0.4 }]).move, "down");
  assert.equal(recommendLevel([{ level: 2, score: 0.9 }]), null);
});

test("맨 위·맨 아래 레벨에서는 그대로를 권한다", () => {
  assert.equal(recommendLevel([{ level: 3, score: 0.95 }, { level: 3, score: 0.9 }]).move, "stay");
  assert.equal(recommendLevel([{ level: 1, score: 0.3 }, { level: 1, score: 0.2 }]).move, "stay");
});

test("연속 일수: 오늘까지 이어진 날을 센다", () => {
  assert.equal(streakDays(["2026-10-04", "2026-10-05", "2026-10-06"], "2026-10-06"), 3);
});

test("연속 일수: 오늘 아직 안 했으면 어제까지로 센다", () => {
  assert.equal(streakDays(["2026-10-04", "2026-10-05"], "2026-10-06"), 2);
});

test("연속 일수: 하루라도 빠지면 끊기고, 월말도 넘긴다", () => {
  assert.equal(streakDays(["2026-10-02", "2026-10-04"], "2026-10-04"), 1);
  assert.equal(streakDays(["2026-09-30", "2026-10-01"], "2026-10-01"), 2);
  assert.equal(streakDays([], "2026-10-01"), 0);
});
