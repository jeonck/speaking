import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHistory, saveAttempt, todayCount, previousAttempt, localDateISO, clearHistory } from "./store.js";

function installFakeStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function installThrowingStorage() {
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
}

test("loadHistory on an empty store returns an empty attempts array", () => {
  installFakeStorage();
  assert.deepEqual(loadHistory("new-slug"), { attempts: [] });
});

test("saveAttempt then loadHistory round-trips and caps at 20 entries", () => {
  installFakeStorage();
  for (let i = 0; i < 25; i++) {
    saveAttempt("demo-slug", { date: "2026-10-04", stage1: { understood: i } });
  }
  const history = loadHistory("demo-slug");
  assert.equal(history.attempts.length, 20);
  assert.equal(history.attempts[history.attempts.length - 1].stage1.understood, 24);
});

test("todayCount only counts attempts matching the given date", () => {
  installFakeStorage();
  saveAttempt("count-slug", { date: "2026-10-03" });
  saveAttempt("count-slug", { date: "2026-10-04" });
  saveAttempt("count-slug", { date: "2026-10-04" });
  assert.equal(todayCount("count-slug", "2026-10-04"), 2);
});

test("previousAttempt returns the most recent saved attempt, or null", () => {
  installFakeStorage();
  assert.equal(previousAttempt("empty-slug"), null);
  saveAttempt("prev-slug", { date: "2026-10-03" });
  saveAttempt("prev-slug", { date: "2026-10-04" });
  assert.equal(previousAttempt("prev-slug").date, "2026-10-04");
});

test("a throwing localStorage never throws out of the store functions", () => {
  installThrowingStorage();
  assert.doesNotThrow(() => saveAttempt("blocked-slug", { date: "2026-10-04" }));
  assert.deepEqual(loadHistory("blocked-slug"), { attempts: [] });
  assert.equal(todayCount("blocked-slug", "2026-10-04"), 0);
  assert.equal(previousAttempt("blocked-slug"), null);
});

test("corrupted JSON in storage falls back to an empty history instead of throwing", () => {
  globalThis.localStorage = {
    getItem: () => "{not json",
    setItem: () => {},
  };
  assert.deepEqual(loadHistory("corrupt-slug"), { attempts: [] });
});

test("같은 id로 저장하면 시도를 새로 쌓지 않고 덮어쓴다 (단계마다 자동 저장)", () => {
  installFakeStorage();
  saveAttempt("upsert-slug", { id: 1, date: "2026-10-05", stage1: { understood: 2 } });
  saveAttempt("upsert-slug", { id: 1, date: "2026-10-05", stage1: { understood: 2 }, stage2: { elapsedSeconds: 20 } });
  const { attempts } = loadHistory("upsert-slug");
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].stage2.elapsedSeconds, 20);
});

test("previousAttempt는 지금 진행 중인 시도를 빼고 그 전 것을 돌려준다", () => {
  installFakeStorage();
  saveAttempt("prev2-slug", { id: 1, date: "2026-10-04" });
  saveAttempt("prev2-slug", { id: 2, date: "2026-10-05" });
  assert.equal(previousAttempt("prev2-slug", 2).id, 1);
});

test("localDateISO는 UTC가 아니라 기기 시간대의 날짜다", () => {
  const d = new Date(2026, 9, 5, 7, 30); // 이 기기 시간으로 10월 5일 오전 7:30
  assert.equal(localDateISO(d), "2026-10-05");
});

test("clearHistory는 그 실습 기록만 지운다", () => {
  installFakeStorage();
  saveAttempt("a-slug", { date: "2026-10-05" });
  saveAttempt("b-slug", { date: "2026-10-05" });
  clearHistory("a-slug");
  assert.equal(loadHistory("a-slug").attempts.length, 0);
  assert.equal(loadHistory("b-slug").attempts.length, 1);
});
