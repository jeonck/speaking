import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSeconds, startCountdown } from "./timer.js";

test("formatSeconds pads single-digit seconds and rounds", () => {
  assert.equal(formatSeconds(5), "0:05");
  assert.equal(formatSeconds(65), "1:05");
  assert.equal(formatSeconds(5.6), "0:06");
  assert.equal(formatSeconds(-1), "0:00");
});

test("startCountdown ticks down once per second and calls onDone at zero", (t, done) => {
  const ticks = [];
  startCountdown(2, {
    onTick: (r) => ticks.push(r),
    onDone: () => {
      assert.deepEqual(ticks, [2, 1, 0]);
      done();
    },
  });
});

test("the cancel function returned by startCountdown stops further ticks", () => {
  let tickCount = 0;
  const cancel = startCountdown(5, { onTick: () => (tickCount += 1), onDone: () => {} });
  cancel();
  return new Promise((resolve) =>
    setTimeout(() => {
      const countAfterCancel = tickCount;
      setTimeout(() => {
        assert.equal(tickCount, countAfterCancel); // no further ticks after cancel
        resolve();
      }, 1100);
    }, 50)
  );
});
