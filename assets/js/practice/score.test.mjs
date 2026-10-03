import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWord, scoreDictation } from "./score.js";

test("normalizeWord strips case and punctuation, keeps internal apostrophe", () => {
  assert.equal(normalizeWord("Don't"), "don't");
  assert.equal(normalizeWord("Happiness,"), "happiness");
  assert.equal(normalizeWord("'Quoted'"), "quoted");
});

test("scoreDictation: perfect match has accuracy 1 and all-match ops", () => {
  const r = scoreDictation("Most people think.", "most people think");
  assert.equal(r.accuracy, 1);
  assert.ok(r.ops.every((o) => o.type === "match"));
});

test("scoreDictation: missing word is classified as missing", () => {
  const r = scoreDictation("the quick brown fox", "the quick fox");
  const types = r.ops.map((o) => o.type);
  assert.ok(types.includes("missing"));
  assert.equal(r.ops.find((o) => o.type === "missing").correct, "brown");
});

test("scoreDictation: substituted word is classified as wrong", () => {
  const r = scoreDictation("hello world today", "hello word today");
  const wrong = r.ops.find((o) => o.type === "wrong");
  assert.ok(wrong);
  assert.equal(wrong.correct, "world");
  assert.equal(wrong.said, "word");
});

test("scoreDictation: empty input gives all missing and accuracy 0", () => {
  const r = scoreDictation("hello world", "");
  assert.equal(r.matchCount, 0);
  assert.equal(r.accuracy, 0);
  assert.equal(r.ops.filter((o) => o.type === "missing").length, 2);
});

test("scoreDictation: unrelated extra input is classified as extra, not crash", () => {
  const r = scoreDictation("hi", "um well actually hi there yeah");
  assert.doesNotThrow(() => scoreDictation("hi", "um well actually hi there yeah"));
  assert.ok(r.ops.some((o) => o.type === "extra"));
  assert.ok(r.ops.some((o) => o.type === "match"));
});
