import { test } from "node:test";
import assert from "node:assert/strict";
import { loadHistory, saveAttempt, todayCount, previousAttempt } from "./store.js";

function installFakeStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
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
