import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStressedSentence, renderChunks, renderDictationResult, escapeHtml } from "./markup.js";

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<a href="x">it's & "quoted"</a>`), "&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; &quot;quoted&quot;&lt;/a&gt;");
});

test("renderStressedSentence escapes a hostile word and wraps syl span", () => {
  const html = renderStressedSentence({
    words: [{ w: "<b>happiness</b>", strong: true, syl: "hap", link: false }],
  });
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("&lt;b&gt;"));
  assert.ok(html.includes('class="pr-syl"'));
});

test("renderStressedSentence skips syl span when syl is not found in the word (case-insensitive ok)", () => {
  const htmlFound = renderStressedSentence({ words: [{ w: "Most", strong: true, syl: "MOS", link: false }] });
  assert.ok(htmlFound.includes("pr-syl"));
  const htmlMissing = renderStressedSentence({ words: [{ w: "Most", strong: true, syl: "xyz", link: false }] });
  assert.ok(!htmlMissing.includes("pr-syl"));
});

test("renderStressedSentence marks weak words and linked words with distinct classes", () => {
  const html = renderStressedSentence({
    words: [
      { w: "from", strong: false, link: true },
      { w: "big", strong: true, syl: "big", link: false },
    ],
  });
  assert.ok(html.includes("pr-weak"));
  assert.ok(html.includes("pr-link"));
  assert.ok(html.includes("pr-strong"));
});

test("renderChunks joins chunk pairs with a break marker and escapes content", () => {
  const html = renderChunks({ chunks: [{ en: "Most people think", ko: "대부분 생각한다" }, { en: "<script>", ko: "덩어리" }] });
  assert.ok(html.includes("Most people think"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

test("renderDictationResult marks each op type with its own class", () => {
  const html = renderDictationResult([
    { type: "match", correct: "hello" },
    { type: "wrong", correct: "world", said: "word" },
    { type: "missing", correct: "today" },
    { type: "extra", said: "um" },
  ]);
  assert.ok(html.includes("pr-dict-match"));
  assert.ok(html.includes("pr-dict-wrong"));
  assert.ok(html.includes("pr-dict-missing"));
  assert.ok(html.includes("pr-dict-extra"));
});
