import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentSeconds, playSpan } from "./segment.js";

test("clips가 없으면 start~end 길이", () => {
  assert.equal(segmentSeconds({ start: 10, end: 38 }), 28);
});

test("clips가 있으면 되풀이를 뺀 합계", () => {
  const seg = { start: 45.5, end: 90.4, clips: [[45.5, 48.6], [63.5, 67.2], [85.7, 90.4]] };
  assert.equal(Math.round(segmentSeconds(seg) * 10) / 10, 11.5);
  assert.deepEqual(playSpan(seg).clips, seg.clips);
});
