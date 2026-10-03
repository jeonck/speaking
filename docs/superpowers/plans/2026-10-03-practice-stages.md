# 4-Stage Practice Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the idiom/vocab blog pipeline with practice pages that walk a learner through the video's 4-stage routine (timed silent reading → timed read-aloud with stress guidance → script-hidden listening → review) for a YouTube segment.

**Architecture:** `pipeline/transcript.py` (new, pure) parses the pasted URL+timestamps and computes sentence timing; `pipeline/generate.py` (rewritten) calls Claude for content only (never timestamps), validates, and writes a Hugo page bundle (`index.md` + `data.json`) under `content/practice/<slug>/`. `layouts/practice/single.html` embeds `data.json` and loads an esbuild-bundled JS app (`assets/js/practice/*.js`) that renders the 4 stages client-side against the YouTube IFrame API, MediaRecorder, and Web Speech API, storing attempt history in `localStorage`.

**Tech Stack:** Hugo (extended, built-in esbuild via `js.Build`), Python 3.12 stdlib only, vanilla JS (ES modules), `node --test` for JS unit tests, PaperMod theme (existing).

**Spec:** [docs/superpowers/specs/2026-10-03-practice-stages-design.md](../specs/2026-10-03-practice-stages-design.md)

## Global Constraints

- No new Python or npm dependencies — stdlib and Hugo's built-in esbuild only (per spec §2 "Node 빌드 체인은 추가하지 않습니다").
- Claude never outputs timestamps; all timing is computed in `transcript.py` from the pasted timestamps (spec §4).
- Privacy rules paragraph (name/age/health/employer generalization) must be carried into the new `GENERATE_PROMPT` verbatim in spirit — this is a public site (spec inherits this from the original skill's non-negotiable rule).
- Max segment length 180 seconds; alignment match ratio must be ≥ 0.6 or the item fails (spec §4, §7).
- `data.json` must escape `</script` before being inlined, since it is embedded via `<script type="application/json">` (spec §5).
- All stage UI copy is Korean; site chrome (menu, homepage) stays English (spec §6).
- `localStorage` access must be wrapped so a blocked/throwing store never breaks the practice flow (spec §7).
- CSS variables must reuse PaperMod's existing tokens (`--primary`, `--secondary`, `--entry`, `--border`, `--theme`, `--code-bg`) and dark-mode selectors must match PaperMod's own (`:root[data-theme="dark"]`, `:root:not([data-theme="light"])`) — confirmed in `themes/PaperMod/assets/css/core/theme-vars.css`.
- Existing proven pieces stay as-is unless this plan explicitly touches them: `yaml_quote`, `slugify`, `sentence_hash`, `log`, `load_state`, `FatalAPIError`, `is_fatal_api_error`, `clear_input`.

## Review Focus

- A pasted block with a URL but zero parseable timestamps must fail that item (not crash the whole run) — Task 1 `compute_segment` test + Task 2 `build_queue` test.
- A video that is privacy-restricted or deleted (oEmbed 404/401/403) must fail that item without touching the API/Claude budget — Task 2 `fetch_oembed_title` + queue loop.
- Claude's `words` list can contain a token that normalizes to empty (e.g. a lone em dash) or a `syl` that doesn't actually occur in its word — both must be cleaned, not crash the stress renderer — Task 2 `parse_result` tests + Task 7 `markup.js` test.
- A learner typing nothing (empty dictation) or garbage unrelated to the sentence must still render a result (all-missing / all-extra), never throw — Task 6 `score.js` test.
- `localStorage` being blocked (private browsing) must not stop the practice stages from working — Task 8 `store.js` test + Task 12 wiring (`ctx.recordAttempt` wrapped, never awaited/thrown into the UI path).

---

## Task 1: `pipeline/transcript.py` — parsing, segment, sentence alignment

**Files:**
- Create: `pipeline/transcript.py`
- Test: `pipeline/test_transcript.py`

**Interfaces:**
- Produces (used by Task 2): `InputError(Exception)`, `parse_video_id(url: str) -> str | None`, `parse_fragments(body: str) -> list[dict]` (each `{"start": float, "text": str}`), `compute_segment(fragments: list[dict]) -> tuple[float, float]` (raises `InputError`), `align_sentences(sentences: list[str], fragments: list[dict], segment_end: float) -> tuple[list[dict], float]` (each timing dict `{"start": float, "end": float}`; second return value is match ratio 0-1), `normalize_word(word: str) -> str`.

- [ ] **Step 1: Write the failing tests**

Create `pipeline/test_transcript.py`:

```python
import unittest

from transcript import (
    InputError,
    align_sentences,
    compute_segment,
    normalize_word,
    parse_fragments,
    parse_video_id,
)


class ParseVideoIdTest(unittest.TestCase):
    def test_four_url_formats(self):
        cases = [
            "https://youtu.be/7KMo8GOwg78?si=abc",
            "https://www.youtube.com/watch?v=7KMo8GOwg78&t=10s",
            "https://youtube.com/shorts/7KMo8GOwg78",
            "https://www.youtube.com/embed/7KMo8GOwg78",
        ]
        for url in cases:
            with self.subTest(url=url):
                self.assertEqual(parse_video_id(url), "7KMo8GOwg78")

    def test_invalid_url_returns_none(self):
        self.assertIsNone(parse_video_id("not a url"))


class ParseFragmentsTest(unittest.TestCase):
    def test_three_timestamp_formats(self):
        body = "4:12\nhello there\n1:02:03\nnext line\n0:05 inline text"
        frags = parse_fragments(body)
        self.assertEqual(
            [(f["start"], f["text"]) for f in frags],
            [(252.0, "hello there"), (3723.0, "next line"), (5.0, "inline text")],
        )

    def test_bracket_only_lines_dropped(self):
        body = "0:01 hi\n[Music]\n0:02 bye\n(applause)"
        frags = parse_fragments(body)
        self.assertEqual([f["text"] for f in frags], ["hi", "bye"])

    def test_no_timestamps_returns_empty(self):
        self.assertEqual(parse_fragments("just some text\nmore text"), [])


class ComputeSegmentTest(unittest.TestCase):
    def test_end_estimated_from_last_fragment_word_count(self):
        frags = [{"start": 0.0, "text": "a"}, {"start": 10.0, "text": "one two three"}]
        start, end = compute_segment(frags)
        self.assertEqual(start, 0.0)
        self.assertAlmostEqual(end, 10.0 + 3 * 0.4)

    def test_over_max_length_raises(self):
        frags = [{"start": 0.0, "text": "a"}, {"start": 200.0, "text": "b"}]
        with self.assertRaises(InputError):
            compute_segment(frags)

    def test_no_fragments_raises(self):
        with self.assertRaises(InputError):
            compute_segment([])


class AlignSentencesTest(unittest.TestCase):
    def test_corrected_mishearing_still_aligns_with_good_ratio(self):
        fragments = [
            {"start": 0.0, "text": "most people think happiness comes from big"},
            {"start": 4.0, "text": "moments a va perfect day"},
            {"start": 8.0, "text": "but research shows"},
        ]
        sentences = [
            "Most people think happiness comes from big moments.",
            "A promotion, a vacation or a perfect day.",
            "But research shows that's not how it works.",
        ]
        timings, ratio = align_sentences(sentences, fragments, segment_end=12.0)
        self.assertEqual(len(timings), 3)
        self.assertEqual(timings[0]["start"], 0.0)
        self.assertGreaterEqual(ratio, 0.6)
        for i in range(len(timings) - 1):
            self.assertLessEqual(timings[i]["start"], timings[i + 1]["start"])
            self.assertEqual(timings[i]["end"], timings[i + 1]["start"])
        self.assertEqual(timings[-1]["end"], 12.0)

    def test_timings_are_monotonic_even_with_reordered_matches(self):
        fragments = [{"start": 0.0, "text": "b a"}]
        sentences = ["A.", "B."]
        timings, _ = align_sentences(sentences, fragments, segment_end=2.0)
        self.assertLessEqual(timings[0]["start"], timings[1]["start"])

    def test_completely_unmatched_sentence_falls_back_after_previous(self):
        fragments = [{"start": 0.0, "text": "hello world"}]
        sentences = ["Hello world.", "Zzz qqq xyz unrelated gibberish."]
        timings, _ = align_sentences(sentences, fragments, segment_end=5.0)
        self.assertGreater(timings[1]["start"], timings[0]["start"])


class NormalizeWordTest(unittest.TestCase):
    def test_strips_punctuation_and_case(self):
        self.assertEqual(normalize_word("Happiness,"), "happiness")
        self.assertEqual(normalize_word("Don’t"), "don't")
        self.assertEqual(normalize_word("“Quoted”"), "quoted")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && python3 -m unittest test_transcript -v`
Expected: `ModuleNotFoundError: No module named 'transcript'`

- [ ] **Step 3: Write `pipeline/transcript.py`**

```python
"""유튜브 URL + 스크립트 패널 복붙 파싱, 구간 계산, 문장-자막 타이밍 정렬.

Claude는 시각을 출력하지 않는다 — 이 모듈의 함수만 숫자를 계산한다.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

VIDEO_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/|shorts/))([A-Za-z0-9_-]{11})"
)
TIMESTAMP_RE = re.compile(r"^(\d{1,2}:)?(\d{1,2}):(\d{2})(?:\s+(.*))?$")
BRACKET_ONLY_RE = re.compile(r"^[\[(].*[\])]$")
MAX_SEGMENT_SECONDS = 180


class InputError(Exception):
    """사용자 입력 형식 오류 — 호출자는 해당 항목만 건너뛴다."""


def parse_video_id(url: str) -> str | None:
    match = VIDEO_ID_RE.search(url.strip())
    return match.group(1) if match else None


def _parse_timestamp_line(line: str) -> tuple[float, str] | None:
    m = TIMESTAMP_RE.match(line.strip())
    if not m:
        return None
    hours = int(m.group(1)[:-1]) if m.group(1) else 0
    minutes = int(m.group(2))
    seconds = int(m.group(3))
    inline_text = (m.group(4) or "").strip()
    return hours * 3600 + minutes * 60 + seconds, inline_text


def parse_fragments(body: str) -> list[dict]:
    """줄 단위로 "시각 단독" 다음 줄 텍스트, 또는 "시각 텍스트" 한 줄을 읽는다.
    괄호로만 이뤄진 줄([Music] 등)은 버린다. 시각 없이 이어지는 줄은 직전
    조각에 이어붙인다."""
    fragments: list[dict] = []
    pending_time: float | None = None
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if BRACKET_ONLY_RE.match(line):
            continue
        parsed = _parse_timestamp_line(line)
        if parsed is not None:
            ts, inline_text = parsed
            if inline_text:
                fragments.append({"start": ts, "text": inline_text})
                pending_time = None
            else:
                pending_time = ts
            continue
        if pending_time is not None:
            fragments.append({"start": pending_time, "text": line})
            pending_time = None
        elif fragments:
            fragments[-1]["text"] = f"{fragments[-1]['text']} {line}"
    return fragments


def estimate_duration(text: str) -> float:
    words = text.split()
    return max(1.5, len(words) * 0.4)


def compute_segment(fragments: list[dict]) -> tuple[float, float]:
    if not fragments:
        raise InputError(
            "타임스탬프를 하나도 찾지 못했습니다 — 스크립트 패널에서 시각 포함해 복사하세요"
        )
    start = fragments[0]["start"]
    last = fragments[-1]
    end = last["start"] + estimate_duration(last["text"])
    if end - start > MAX_SEGMENT_SECONDS:
        raise InputError(f"구간이 {end - start:.0f}초로 {MAX_SEGMENT_SECONDS}초 제한을 초과했습니다")
    return start, end


_PUNCT_RE = re.compile(r"[^a-z0-9']")
_EDGE_APOSTROPHE_RE = re.compile(r"(?<![a-z0-9])'+|'+(?![a-z0-9])")


def normalize_word(word: str) -> str:
    w = word.lower().replace("’", "'").replace("‘", "'")
    w = w.replace("“", "").replace("”", "")
    w = _EDGE_APOSTROPHE_RE.sub("", w)
    w = _PUNCT_RE.sub("", w)
    return w


def _tokenize(text: str) -> list[str]:
    return text.split()


def align_sentences(
    sentences: list[str], fragments: list[dict], segment_end: float
) -> tuple[list[dict], float]:
    """문장별 {start, end}를 계산한다. 반환값: (타이밍 리스트, 정렬 일치율 0-1)."""
    frag_words: list[tuple[str, float]] = []
    for i, frag in enumerate(fragments):
        words = _tokenize(frag["text"])
        if not words:
            continue
        next_start = fragments[i + 1]["start"] if i + 1 < len(fragments) else segment_end
        span = max(next_start - frag["start"], 0.01)
        step = span / len(words)
        for j, w in enumerate(words):
            frag_words.append((w, frag["start"] + j * step))

    frag_norm = [normalize_word(w) for w, _ in frag_words]

    sent_word_lists = [_tokenize(s) for s in sentences]
    sent_norm_flat: list[str] = []
    sent_bounds: list[tuple[int, int]] = []
    for words in sent_word_lists:
        start_idx = len(sent_norm_flat)
        sent_norm_flat.extend(normalize_word(w) for w in words)
        sent_bounds.append((start_idx, len(sent_norm_flat)))

    matcher = SequenceMatcher(None, frag_norm, sent_norm_flat, autojunk=False)
    ratio = matcher.ratio()
    blocks = matcher.get_matching_blocks()

    sent_to_frag: dict[int, int] = {}
    for block in blocks:
        for k in range(block.size):
            sent_to_frag[block.b + k] = block.a + k

    segment_start = fragments[0]["start"] if fragments else 0.0
    timings: list[dict] = []
    prev_end = segment_start
    for start_idx, end_idx in sent_bounds:
        found = None
        for idx in range(start_idx, end_idx):
            if idx in sent_to_frag:
                frag_idx = sent_to_frag[idx]
                if 0 <= frag_idx < len(frag_words):
                    found = frag_words[frag_idx][1]
                break
        if found is None or found <= prev_end:
            found = prev_end + 0.1
        timings.append({"start": found})
        prev_end = found

    for i in range(len(timings) - 1):
        timings[i]["end"] = timings[i + 1]["start"]
    if timings:
        timings[-1]["end"] = segment_end

    return timings, ratio
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && python3 -m unittest test_transcript -v`
Expected: all tests PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add pipeline/transcript.py pipeline/test_transcript.py
git commit -m "feat: add transcript parsing and sentence-timing alignment"
```

## Task 2: `pipeline/generate.py` — practice-schema rewrite

**Files:**
- Modify: `pipeline/generate.py` (full-file replacement — the idiom/fallback pipeline is removed entirely; see Interfaces for what carries over unchanged)
- Test: `pipeline/test_generate.py`

**Interfaces:**
- Consumes (from Task 1): `transcript.InputError`, `transcript.parse_video_id`, `transcript.parse_fragments`, `transcript.compute_segment`, `transcript.align_sentences`, `transcript.normalize_word`.
- Unchanged from the existing file (copy verbatim, do not reinvent): `log(msg)`, `sentence_hash(s)`, `slugify(title)`, `yaml_quote(s)`, `FatalAPIError`, `is_fatal_api_error(exc)`, `clear_input()`, `load_state()`.
- Removed entirely: `FALLBACK_QUOTES`, `QUOTE_NOTE`, `fallback_quote_item`, `read_sentences` (old per-line version), `build_prompt`, `html_escape`, `write_post`, `HEADING_*` constants.
- Produces (used by Task 2's own `main()`, and by tests): `fetch_oembed_title(video_id: str) -> str | None` (raises `transcript.InputError` on 401/403/404), `build_queue(today: date) -> list[dict]` (each item `{"video_id", "url", "fragments", "start", "end", "dedup_key"}`), `parse_result(text: str) -> dict | None`, `write_practice_bundle(item: dict, result: dict, source_title: str | None, date: datetime) -> Path` (returns the `index.md` path), `CONTENT_DIR` now points at `content/practice`.

- [ ] **Step 1: Write the failing tests**

Create `pipeline/test_generate.py`:

```python
import json
import shutil
import sys
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate  # noqa: E402

KST = timezone(timedelta(hours=9))

VALID_RESULT = {
    "title": "Happiness Is Frequency",
    "summary": "A short segment about why frequency beats intensity for happiness.",
    "tags": ["happiness", "research", "science", "fourth-dropped"],
    "sentences": [
        {
            "text": "Most people think happiness comes from big moments.",
            "chunks": [
                {"en": "Most people think", "ko": "대부분 사람들은 생각한다"},
                {"en": "happiness comes from big moments", "ko": "행복은 큰 순간들에서 온다고"},
            ],
            "words": [
                {"w": "Most", "strong": True, "syl": "Most", "link": False},
                {"w": "people", "strong": False, "link": False},
                {"w": "think", "strong": True, "syl": "think", "link": False},
                {"w": "happiness", "strong": True, "syl": "hap", "link": False},
                {"w": "comes", "strong": False, "link": True},
                {"w": "from", "strong": False, "link": False},
                {"w": "big", "strong": True, "syl": "big", "link": False},
                {"w": "moments.", "strong": True, "syl": "mo", "link": False},
            ],
            "tip": "comes from 는 약하게 이어 읽는다",
        }
    ],
    "questions": [
        {"q": "What matters most for happiness?", "options": ["Intensity", "Frequency", "Luck"], "answer": 1, "why": "빈도가 중요하다고 말함"},
        {"q": "Q2", "options": ["A", "B", "C"], "answer": 0, "why": "w"},
        {"q": "Q3", "options": ["A", "B", "C"], "answer": 0, "why": "w"},
    ],
    "vocab": [{"term": "simply put", "ko": "간단히 말하면", "note": "결론 요약"}],
}


class ParseResultTest(unittest.TestCase):
    def test_valid_json_parses_and_tags_truncated_to_three(self):
        result = generate.parse_result(json.dumps(VALID_RESULT))
        self.assertIsNotNone(result)
        self.assertEqual(len(result["tags"]), 3)

    def test_missing_title_rejected(self):
        bad = json.loads(json.dumps(VALID_RESULT))
        del bad["title"]
        self.assertIsNone(generate.parse_result(json.dumps(bad)))

    def test_too_few_questions_rejected(self):
        bad = json.loads(json.dumps(VALID_RESULT))
        bad["questions"] = bad["questions"][:2]
        self.assertIsNone(generate.parse_result(json.dumps(bad)))

    def test_answer_out_of_range_rejected(self):
        bad = json.loads(json.dumps(VALID_RESULT))
        bad["questions"][0]["answer"] = 9
        self.assertIsNone(generate.parse_result(json.dumps(bad)))

    def test_empty_normalized_word_is_dropped(self):
        good = json.loads(json.dumps(VALID_RESULT))
        good["sentences"][0]["words"].insert(0, {"w": "—", "strong": False, "link": False})
        result = generate.parse_result(json.dumps(good))
        self.assertNotIn("—", [w["w"] for w in result["sentences"][0]["words"]])

    def test_syl_not_found_in_word_is_dropped_not_fatal(self):
        good = json.loads(json.dumps(VALID_RESULT))
        good["sentences"][0]["words"][0]["syl"] = "xyz"
        result = generate.parse_result(json.dumps(good))
        self.assertNotIn("syl", result["sentences"][0]["words"][0])

    def test_non_json_text_rejected(self):
        self.assertIsNone(generate.parse_result("Sorry, I can't help with that."))


class WritePracticeBundleTest(unittest.TestCase):
    def setUp(self):
        self.result = generate.parse_result(json.dumps(VALID_RESULT))
        self.result["sentences"][0]["start"] = 0.0
        self.result["sentences"][0]["end"] = 4.3
        self.item = {"video_id": "7KMo8GOwg78", "start": 0.0, "end": 4.3}
        self.now = datetime(2026, 10, 4, tzinfo=KST)
        self.created: list[Path] = []

    def tearDown(self):
        for path in self.created:
            if path.exists():
                shutil.rmtree(path)

    def test_writes_index_and_data_json(self):
        path = generate.write_practice_bundle(self.item, self.result, "Original Title", self.now)
        self.created.append(path.parent)
        self.assertTrue(path.exists())
        data = json.loads((path.parent / "data.json").read_text())
        self.assertEqual(data["video_id"], "7KMo8GOwg78")
        self.assertEqual(data["source_title"], "Original Title")
        self.assertEqual(data["sentences"][0]["start"], 0.0)

    def test_script_close_tag_in_data_is_escaped(self):
        self.result["summary"] = "a </script> tag"
        path = generate.write_practice_bundle(self.item, self.result, None, self.now)
        self.created.append(path.parent)
        raw = (path.parent / "data.json").read_text()
        self.assertNotIn("</script>", raw)


class FakeHTTPResponse:
    def __init__(self, payload: bytes):
        self._payload = payload

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FetchOembedTitleTest(unittest.TestCase):
    def test_success_returns_title(self):
        payload = json.dumps({"title": "Happiness Is Frequency"}).encode("utf-8")
        with mock.patch("generate.urllib.request.urlopen", return_value=FakeHTTPResponse(payload)):
            title = generate.fetch_oembed_title("7KMo8GOwg78")
        self.assertEqual(title, "Happiness Is Frequency")

    def test_403_raises_input_error(self):
        err = urllib.error.HTTPError("url", 403, "Forbidden", {}, None)
        with mock.patch("generate.urllib.request.urlopen", side_effect=err):
            with self.assertRaises(generate.InputError):
                generate.fetch_oembed_title("private-video")

    def test_404_raises_input_error(self):
        err = urllib.error.HTTPError("url", 404, "Not Found", {}, None)
        with mock.patch("generate.urllib.request.urlopen", side_effect=err):
            with self.assertRaises(generate.InputError):
                generate.fetch_oembed_title("deleted-video")

    def test_500_returns_none_without_raising(self):
        err = urllib.error.HTTPError("url", 500, "Server Error", {}, None)
        with mock.patch("generate.urllib.request.urlopen", side_effect=err):
            title = generate.fetch_oembed_title("flaky-video")
        self.assertIsNone(title)

    def test_network_error_returns_none_without_raising(self):
        with mock.patch("generate.urllib.request.urlopen", side_effect=TimeoutError("timed out")):
            title = generate.fetch_oembed_title("slow-video")
        self.assertIsNone(title)


class BuildQueueTest(unittest.TestCase):
    def setUp(self):
        self.original = (
            generate.SENTENCE_FILE.read_text(encoding="utf-8")
            if generate.SENTENCE_FILE.exists()
            else None
        )

    def tearDown(self):
        if self.original is not None:
            generate.SENTENCE_FILE.write_text(self.original, encoding="utf-8")

    def test_invalid_url_is_skipped_not_fatal(self):
        generate.SENTENCE_FILE.write_text("```\nnot a youtube url\n0:01 hi\n```\n", encoding="utf-8")
        items = generate.build_queue(datetime.now(KST).date())
        self.assertEqual(items, [])

    def test_valid_block_produces_one_item(self):
        generate.SENTENCE_FILE.write_text(
            "```\nhttps://youtu.be/7KMo8GOwg78\n0:01 hello there\n0:03 friend\n```\n",
            encoding="utf-8",
        )
        items = generate.build_queue(datetime.now(KST).date())
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["video_id"], "7KMo8GOwg78")

    def test_segment_too_long_is_skipped_not_fatal(self):
        generate.SENTENCE_FILE.write_text(
            "```\nhttps://youtu.be/7KMo8GOwg78\n0:00 start\n5:00 way too late\n```\n",
            encoding="utf-8",
        )
        items = generate.build_queue(datetime.now(KST).date())
        self.assertEqual(items, [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd pipeline && python3 -m unittest test_generate -v`
Expected: `AttributeError` (old `generate.py` has no `parse_result` matching this schema, no `write_practice_bundle`, no `build_queue` matching this signature)

- [ ] **Step 3: Replace `pipeline/generate.py` in full**

```python
#!/usr/bin/env python3
"""Transcript study pipeline — 유튜브 구간 → 4단계 실습 페이지.

input/script.md 코드블록에 유튜브 URL + 스크립트 패널 복붙을 넣으면, 그 구간으로
직독직해 → 낭독 → 가리고 듣기 → 정리 4단계 실습 페이지(content/practice/<slug>/)를
생성한다. Claude는 문장 내용(의미 덩어리, 강세, 문제, 어휘)만 만들고, 문장별 재생
시각은 이 파일이 transcript.py로 계산한다 — Claude는 숫자를 출력하지 않는다.

코드블록 안에서 `---` 만 있는 줄로 구분하면 구간 여러 개를 각각 별도 페이지로
처리한다. 이미 게시에 사용된 구간(video_id+시작+끝 해시 기준)은 다시 나타나도
건너뛴다. 입력이 비어 있으면 아무것도 하지 않고 정상 종료한다(후킹 전용 모드).

Usage:
    python pipeline/generate.py [--dry-run]

Env:
    JUDGE_BACKEND            "claude-code" | "api" (기본: 자동 — claude CLI가 있으면
                             claude-code, 없으면 api)
    CLAUDE_CODE_OAUTH_TOKEN  claude-code 백엔드 CI 인증 (claude setup-token으로 발급,
                             로컬은 claude 로그인 세션 사용)
    ANTHROPIC_API_KEY        api 백엔드 필수
    CLAUDE_MODEL             생성 모델 (기본 claude-sonnet-4-6)
"""

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

from transcript import (
    InputError,
    align_sentences,
    compute_segment,
    normalize_word,
    parse_fragments,
    parse_video_id,
)

ROOT = Path(__file__).resolve().parent.parent
SENTENCE_FILE = ROOT / "input" / "script.md"
STATE_FILE = ROOT / "pipeline" / "state.json"
CONTENT_DIR = ROOT / "content" / "practice"

KST = timezone(timedelta(hours=9))

# ============================== 도메인 설정 =================================
# 이 블록만 새 프로젝트 주제에 맞게 교체한다. 아래 엔진 코드는 건드릴 필요 없다.

OEMBED_URL = (
    "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
)

SYSTEM_PROMPT = """You are an English listening-and-speaking coach. You take a short \
segment transcript from a YouTube video (auto-captions; may contain transcription \
errors) and turn it into materials for a 4-stage practice routine: timed silent \
reading, timed read-aloud with stress/rhythm guidance, listening comprehension, and \
dictation. All English output is natural; chunk translations, question rationales, \
and notes are in Korean as specified below. This output is published on a public \
website, so you must never carry over any personally identifying or private \
information from the transcript — see the privacy rules below."""

# {duration}/{title_note}/{fragments} 세 자리를 반드시 유지. JSON 스키마의 이중
# 중괄호는 str.format() 이스케이프이므로 스키마를 고칠 때도 그대로 유지한다.
GENERATE_PROMPT = """Below are numbered auto-caption fragments from a {duration:.0f}-second \
YouTube segment{title_note}. Merge them into natural sentences and produce practice \
materials. Respond ONLY with JSON in exactly this format, no other text:

{{"title": "Short English title for this segment",
 "summary": "1-2 sentence English summary of what the segment is about",
 "tags": ["kebab-case-tag", "max 3"],
 "sentences": [
   {{"text": "Full sentence text, fillers/false starts from the transcript cleaned up",
     "chunks": [{{"en": "a meaning chunk covering part of the sentence", "ko": "그 \
덩어리의 한국어 뜻, 영어 어순 그대로"}}],
     "words": [{{"w": "word exactly as it appears in text (with trailing punctuation)", \
"strong": true, "syl": "stressed syllable spelling, only if strong", "link": false}}],
     "tip": "one short Korean line on a stress/linking/reduction point in this sentence, optional"}}
 ],
 "questions": [
   {{"q": "English comprehension question about the segment",
     "options": ["option A", "option B", "option C"],
     "answer": 0,
     "why": "one short Korean line citing the sentence that supports the answer"}}
 ],
 "vocab": [
   {{"term": "word or phrase worth remembering", "ko": "간단한 한국어 뜻", "note": "one short Korean usage note"}}
 ]}}

Privacy rules (apply to every field): strip or generalize anything that could identify \
a real person. Never include real names (rewrite as "the speaker", "a guest", etc.); \
never include exact ages, health conditions, immigration status, employers, school \
names, addresses, phone numbers, emails, or handles, even if the transcript states \
them. When in doubt, generalize.

Requirements:
- "chunks" must cover the ENTIRE sentence text in order with no gaps or overlaps.
- "words" must list every word of "text" in order (including the final word's \
punctuation attached, e.g. "day."); this is used to render stress markup, so the \
concatenation of all "w" values (joined by single spaces) must reproduce "text".
- Mark 2-5 content words per sentence as "strong": true (the words a natural speaker \
stresses); everything else is "strong": false. Only "strong" words get "syl".
- Set "link": true on a word when it liaises into the next word (consonant-to-vowel, \
same-consonant, etc.) as a natural speaker would run them together.
- 3-5 questions, 3-4 options each, "answer" is a 0-based index into "options".
- 2-6 "vocab" entries, prioritizing phrases a learner would stumble on reading \
left-to-right without translating.

Numbered fragments:
{fragments}"""

# ============================ 도메인 설정 끝 =================================


def log(msg: str) -> None:
    print(msg, flush=True)


def sentence_hash(s: str) -> str:
    import hashlib

    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.lower()).strip("-")
    return (slug or "practice")[:60].rstrip("-")


def fetch_oembed_title(video_id: str) -> str | None:
    """oEmbed로 영상 제목을 가져온다. 임베드 자체가 불가능한 경우만 실패시키고,
    그 외 네트워크 오류는 제목 없이 진행하도록 None을 돌려준다."""
    url = OEMBED_URL.format(video_id=video_id)
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("title")
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            raise InputError(f"영상을 임베드할 수 없습니다 (oEmbed {exc.code})") from exc
        log(f"  oEmbed 경고: HTTP {exc.code} — 제목 없이 진행")
        return None
    except Exception as exc:  # noqa: BLE001 - 네트워크 전반, 항목을 막지 않는다
        log(f"  oEmbed 경고: {exc} — 제목 없이 진행")
        return None


def build_queue(today) -> list[dict]:
    """input/script.md 코드블록을 읽어 처리할 구간 목록을 만든다. 형식이 잘못된
    블록은 로그만 남기고 건너뛴다 — 하나가 깨져도 나머지는 처리된다."""
    if not SENTENCE_FILE.exists():
        log(f"오류: {SENTENCE_FILE} 파일이 없습니다")
        sys.exit(1)
    text = SENTENCE_FILE.read_text(encoding="utf-8")
    fenced = re.search(r"```[a-zA-Z]*\n(.*?)```", text, re.DOTALL)
    body = fenced.group(1) if fenced else text
    raw_blocks = re.split(r"^\s*---+\s*$", body, flags=re.MULTILINE)
    blocks = [b.strip() for b in raw_blocks if b.strip() and not b.strip().startswith("<!--")]

    items: list[dict] = []
    for block in blocks:
        lines = block.splitlines()
        url_line = next((l for l in lines if l.strip()), "")
        video_id = parse_video_id(url_line)
        if not video_id:
            log(f"입력 오류: 첫 줄에 유튜브 URL이 필요합니다 — {url_line[:60]!r}")
            continue
        rest = "\n".join(lines[lines.index(url_line) + 1 :])
        try:
            fragments = parse_fragments(rest)
            start, end = compute_segment(fragments)
        except InputError as exc:
            log(f"입력 오류: {exc}")
            continue
        items.append(
            {
                "video_id": video_id,
                "url": url_line.strip(),
                "fragments": fragments,
                "start": start,
                "end": end,
                "dedup_key": sentence_hash(f"{video_id}:{start:.1f}:{end:.1f}"),
            }
        )
    return items


class FatalAPIError(Exception):
    """재시도가 무의미한 오류(크레딧 부족, 인증 실패) — 실행 전체 중단."""


def is_fatal_api_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return any(
        marker in msg
        for marker in (
            "credit balance",
            "authenticat",
            "invalid x-api-key",
            "invalid api key",
            "invalid bearer token",
            "oauth token",
            "/login",
            "401",
        )
    )


def parse_result(text: str) -> dict | None:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

    if not isinstance(data.get("title"), str) or not data["title"].strip():
        return None
    if not isinstance(data.get("summary"), str) or not data["summary"].strip():
        return None

    sentences = data.get("sentences")
    if not isinstance(sentences, list) or not sentences:
        return None
    for s in sentences:
        if not isinstance(s, dict) or not isinstance(s.get("text"), str) or not s["text"].strip():
            return None
        chunks = s.get("chunks")
        if not isinstance(chunks, list) or not chunks:
            return None
        words = s.get("words")
        if not isinstance(words, list) or not words:
            return None
        cleaned_words = []
        for w in words:
            if not isinstance(w, dict):
                continue
            token = str(w.get("w", ""))
            if not normalize_word(token):
                continue  # 정규화하면 빈 문자열인 토큰(예: 단독 — )은 버림
            entry = {
                "w": token,
                "strong": bool(w.get("strong")),
                "link": bool(w.get("link")),
            }
            syl = w.get("syl")
            if (
                entry["strong"]
                and isinstance(syl, str)
                and syl.strip()
                and syl.lower() in token.lower()
            ):
                entry["syl"] = syl
            cleaned_words.append(entry)
        if not cleaned_words:
            return None
        s["words"] = cleaned_words
        s["tip"] = str(s.get("tip") or "").strip()

    questions = data.get("questions")
    if not isinstance(questions, list) or not (3 <= len(questions) <= 5):
        return None
    for q in questions:
        if not isinstance(q, dict):
            return None
        options = q.get("options")
        if not isinstance(options, list) or not (3 <= len(options) <= 4):
            return None
        answer = q.get("answer")
        if not isinstance(answer, int) or isinstance(answer, bool) or not (0 <= answer < len(options)):
            return None
        q["why"] = str(q.get("why") or "").strip()

    vocab = data.get("vocab") or []
    data["vocab"] = vocab if isinstance(vocab, list) else []

    tags = data.get("tags") or []
    data["tags"] = [slugify(str(t)) for t in tags[:3] if str(t).strip()] or ["practice"]

    return data


def generate_api(client, model: str, prompt: str) -> dict | None:
    for attempt in (1, 2):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:  # noqa: BLE001
            if is_fatal_api_error(exc):
                raise FatalAPIError(str(exc)) from exc
            log(f"  API 오류 (시도 {attempt}): {exc}")
            if attempt == 2:
                return None
            continue
        text = next((b.text for b in response.content if b.type == "text"), "")
        result = parse_result(text)
        if result:
            return result
        log(f"  JSON 파싱/검증 실패 (시도 {attempt}): {text[:120]!r}")
    return None


def generate_cli(model: str, prompt: str) -> dict | None:
    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)
    cmd = [
        "claude",
        "-p",
        "--model",
        model,
        "--tools",
        "",
        "--output-format",
        "text",
        "--append-system-prompt",
        SYSTEM_PROMPT,
    ]
    for attempt in (1, 2):
        try:
            result = subprocess.run(
                cmd, input=prompt, env=env, timeout=360, capture_output=True, text=True
            )
        except subprocess.TimeoutExpired:
            log(f"  CLI 타임아웃 (시도 {attempt})")
            continue
        if result.returncode != 0:
            err = (result.stderr or result.stdout).strip()
            if is_fatal_api_error(RuntimeError(err)):
                raise FatalAPIError(err[:300])
            log(f"  CLI 오류 (시도 {attempt}): {err[:200]}")
            if attempt == 2:
                return None
            continue
        parsed = parse_result(result.stdout)
        if parsed:
            return parsed
        log(f"  JSON 파싱/검증 실패 (시도 {attempt}): {result.stdout[:120]!r}")
    return None


def yaml_quote(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_practice_bundle(
    item: dict, result: dict, source_title: str | None, date: datetime
) -> Path:
    """content/practice/<slug>/{index.md,data.json} 페이지 번들을 쓴다."""
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    base = f"{date.date().isoformat()}-{slugify(result['title'])}"
    dir_path = CONTENT_DIR / base
    n = 2
    while dir_path.exists():
        dir_path = CONTENT_DIR / f"{base}-{n}"
        n += 1
    dir_path.mkdir(parents=True)

    tags_str = ", ".join(yaml_quote(t) for t in result["tags"])
    duration_seconds = math.ceil(item["end"] - item["start"])
    index_md = f"""---
title: {yaml_quote(f"{date.date().isoformat()} {result['title']}")}
date: {date.isoformat()}
summary: {yaml_quote(result['summary'])}
tags: [{tags_str}]
video_id: {yaml_quote(item['video_id'])}
duration: {duration_seconds}
---
"""
    (dir_path / "index.md").write_text(index_md, encoding="utf-8")

    data = {
        "video_id": item["video_id"],
        "source_title": source_title,
        "segment": {"start": item["start"], "end": item["end"]},
        "sentences": result["sentences"],
        "questions": result["questions"],
        "vocab": result["vocab"],
    }
    data_json = json.dumps(data, ensure_ascii=False, indent=1)
    # <script type="application/json"> 안에 그대로 삽입되므로 </script 리터럴을 이스케이프
    data_json = data_json.replace("</script", "<\\/script")
    (dir_path / "data.json").write_text(data_json, encoding="utf-8")

    return dir_path / "index.md"


def clear_input() -> None:
    """게시가 끝난 뒤 input/script.md 코드블록을 비운다 (안내 주석은 유지)."""
    text = SENTENCE_FILE.read_text(encoding="utf-8")
    cleared = re.sub(r"```[a-zA-Z]*\n.*?```", "```\n```", text, count=1, flags=re.DOTALL)
    if cleared != text:
        SENTENCE_FILE.write_text(cleared, encoding="utf-8")
        log("input/script.md 코드블록을 비웠습니다 (게시 완료)")


def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcript study pipeline")
    parser.add_argument(
        "--dry-run", action="store_true", help="파일 생성/state.json 갱신 없이 결과만 출력"
    )
    args = parser.parse_args()

    backend = os.environ.get("JUDGE_BACKEND", "").strip() or (
        "claude-code" if shutil.which("claude") else "api"
    )
    client = None
    if backend == "api":
        if not os.environ.get("ANTHROPIC_API_KEY"):
            log("오류: api 백엔드에는 ANTHROPIC_API_KEY 환경변수가 필요합니다")
            return 1
        import anthropic  # 지연 임포트

        client = anthropic.Anthropic()
    elif backend == "claude-code":
        if not shutil.which("claude"):
            log("오류: claude-code 백엔드에는 claude CLI가 PATH에 있어야 합니다")
            return 1
    else:
        log(f"오류: 알 수 없는 JUDGE_BACKEND={backend!r} (claude-code | api)")
        return 1

    model = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-6")
    today = datetime.now(KST).date()
    queue = build_queue(today)
    if not queue:
        log("input/script.md 에 유효한 구간이 없습니다 — 오늘은 건너뜁니다")
        return 0
    log(f"입력된 구간 {len(queue)}개")

    state = load_state()
    processed: dict = state.get("processed", {})

    log(f"=== 생성 시작 (backend={backend}, model={model}, dry_run={args.dry_run}) ===")

    new_count = 0
    skipped_dup = 0
    failed = 0
    fatal_error: Exception | None = None
    for item in queue:
        h = item["dedup_key"]
        if h in processed:
            skipped_dup += 1
            continue

        duration = item["end"] - item["start"]
        log(f"\n오늘의 구간: {item['video_id']} ({duration:.0f}초)")
        try:
            source_title = fetch_oembed_title(item["video_id"])
        except InputError as exc:
            log(f"  건너뜁니다: {exc}")
            failed += 1
            continue

        fragments_text = "\n".join(
            f"{i + 1}. {f['text']}" for i, f in enumerate(item["fragments"])
        )
        title_note = f' (video title: "{source_title}")' if source_title else ""
        prompt = GENERATE_PROMPT.format(
            duration=duration, title_note=title_note, fragments=fragments_text
        )

        try:
            if backend == "claude-code":
                result = generate_cli(model, prompt)
            else:
                result = generate_api(client, model, prompt)
        except FatalAPIError as exc:
            fatal_error = exc
            break

        if result is None:
            log("  생성 실패 — 건너뜁니다 (다음 실행에서 재시도)")
            failed += 1
            continue

        sentence_texts = [s["text"] for s in result["sentences"]]
        timings, ratio = align_sentences(sentence_texts, item["fragments"], item["end"])
        if ratio < 0.6:
            log(f"  생성된 문장이 자막과 맞지 않습니다 (일치율 {ratio:.2f}) — 건너뜁니다")
            failed += 1
            continue
        for s, t in zip(result["sentences"], timings):
            s["start"] = t["start"]
            s["end"] = t["end"]

        now = datetime.now(KST)
        log(f"  → {result['title']} (일치율 {ratio:.2f})")

        if args.dry_run:
            log(json.dumps(result, ensure_ascii=False, indent=2))
            continue

        path = write_practice_bundle(item, result, source_title, now)
        log(f"  생성 파일: {path.relative_to(ROOT)}")
        processed[h] = now.date().isoformat()
        new_count += 1

    log(f"\n=== 결과: 신규 {new_count} / 중복 스킵 {skipped_dup} / 실패 {failed} ===")

    if args.dry_run:
        log("(dry-run — 파일 생성/기록 갱신 없음)")
        return 1 if fatal_error else 0

    if new_count:
        state["processed"] = processed
        STATE_FILE.write_text(json.dumps(state, indent=1, sort_keys=True), encoding="utf-8")

    if new_count and not failed and fatal_error is None:
        clear_input()

    if fatal_error:
        log(f"\n중단: 복구 불가능한 API 오류 — {fatal_error}")
        log("→ Anthropic 크레딧/API 키(또는 CLAUDE_CODE_OAUTH_TOKEN)를 확인하세요.")
        log("→ 성공한 항목은 이미 게시/기록되었습니다.")
        return 1
    return 1 if failed and not new_count else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd pipeline && python3 -m unittest test_generate -v`
Expected: all tests PASS (17 tests). Also re-run `python3 -m unittest test_transcript -v` to confirm Task 1 is untouched.

- [ ] **Step 5: Commit**

```bash
git add pipeline/generate.py pipeline/test_generate.py
git commit -m "feat: rewrite pipeline to generate 4-stage practice pages"
```

## Task 3: Hugo scaffolding — `practice` section, layout, CSS, content cleanup

**Files:**
- Create: `layouts/practice/single.html`
- Create: `assets/css/extended/practice.css`
- Create: `content/practice/.gitkeep`
- Modify: `hugo.toml`
- Delete: `content/posts/2026-10-04-getting-on-the-same-page.md`, `content/posts/2026-10-04-a-day-at-the-beach-and-irregular-past-tenses.md`, `content/posts/.gitkeep`
- Modify: `pipeline/state.json` (reset to `{"processed": {}}`)

**Interfaces:**
- Produces: a page at `content/practice/<slug>/index.md` renders via `layouts/practice/single.html`, which expects page resource `data.json` (written by Task 2) and front matter `video_id`, `duration` (written by Task 2). The template creates `<div id="practice-root" data-video-id="...">` and `<script type="application/json" id="practice-data">` for Task 12's `main.js` to read — do not rename these two ids, every later JS task depends on them.
- Consumes: `resources.Get "js/practice/main.js"` (created in Task 12) via `js.Build` — the layout references this path now; it will 404/fail to resolve until Task 12 exists, which is expected and fine since no content exists yet to render it against.

- [ ] **Step 1: Delete the old blog content and reset state**

```bash
rm -f content/posts/2026-10-04-getting-on-the-same-page.md \
      content/posts/2026-10-04-a-day-at-the-beach-and-irregular-past-tenses.md \
      content/posts/.gitkeep
rmdir content/posts 2>/dev/null || true
mkdir -p content/practice
touch content/practice/.gitkeep
```

Overwrite `pipeline/state.json`:

```json
{
 "processed": {}
}
```

- [ ] **Step 2: Write `layouts/practice/single.html`**

```html
{{- define "main" }}
<article class="practice-page">
  <header class="practice-header">
    {{ partial "breadcrumbs.html" . }}
    <h1>{{ .Title }}</h1>
    <p class="practice-meta">
      구간 {{ .Params.duration }}초
      {{- with .Params.summary }} · {{ . }}{{ end }}
    </p>
  </header>

  <div id="practice-root" data-video-id="{{ .Params.video_id }}"></div>

  {{- $dataFile := .Resources.Get "data.json" }}
  {{- if $dataFile }}
  <script type="application/json" id="practice-data">{{ $dataFile.Content | safeJS }}</script>
  {{- end }}

  {{- $js := resources.Get "js/practice/main.js" }}
  {{- if $js }}
  {{- $built := $js | js.Build (dict "targetPath" "js/practice.js" "minify" hugo.IsProduction) }}
  <script src="{{ $built.RelPermalink }}" defer></script>
  {{- end }}
</article>
{{- end }}
```

- [ ] **Step 3: Write `assets/css/extended/practice.css`**

```css
/* 실습 페이지 전용 스타일. 테마 파일은 직접 수정하지 않는다 — 이 파일이
   PaperMod가 지원하는 assets/css/extended/*.css 오버라이드 훅이다. */

.practice-header { margin-bottom: 1rem; }
.practice-meta { color: var(--secondary); font-size: 0.95rem; }

#practice-root { display: flex; flex-direction: column; gap: 1rem; }

/* 2단계의 "원음" 재생은 영상 없이 소리만 필요하므로 플레이어를 화면에서 숨긴다
   (display:none은 YouTube IFrame이 재생을 멈추는 경우가 있어 0x0 크기로 숨긴다). */
.pr-hidden-player { position: absolute; width: 1px; height: 1px; overflow: hidden; }
.pr-player-notice { color: #a15c00; font-size: 0.9rem; }

.practice-player-wrap {
  position: relative;
  width: 100%;
  max-width: 640px;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: var(--radius);
  overflow: hidden;
}
.practice-player-wrap iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.practice-cover {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  background: var(--theme); color: var(--primary);
  text-align: center; padding: 1rem;
}

.practice-tabs { display: flex; gap: 0.5rem; flex-wrap: wrap; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
.practice-tab {
  padding: 0.4rem 0.8rem; border-radius: 999px; border: 1px solid var(--border);
  background: var(--entry); cursor: pointer; font-weight: 600; color: var(--secondary);
}
.practice-tab[aria-selected="true"] { background: var(--primary); color: var(--theme); border-color: var(--primary); }

.practice-panel[data-active="false"] { display: none; }

.practice-timer { font-variant-numeric: tabular-nums; font-size: 1.3rem; font-weight: 700; }

.pr-script.pr-blurred { filter: blur(5px); user-select: none; pointer-events: none; }

/* 강세 표기 */
.pr-word { display: inline-block; margin-right: 0.15em; }
.pr-strong { font-weight: 700; }
.pr-weak { opacity: 0.55; }
.pr-syl { text-decoration: underline; text-decoration-thickness: 2px; }
.pr-link::after { content: "\203F"; margin-left: 0.05em; opacity: 0.6; }
.pr-chunk-break { margin-right: 0.4em; color: var(--secondary); }
.pr-chunk { display: inline; }
.pr-chunk-ko { display: block; color: var(--secondary); font-size: 0.92rem; margin-top: 0.2rem; }

.pr-sentence-row { padding: 0.6rem 0; border-bottom: 1px dashed var(--border); }
.pr-check-group { display: flex; gap: 0.5rem; margin-top: 0.3rem; }
.pr-check-group button { padding: 0.25rem 0.6rem; border-radius: 6px; border: 1px solid var(--border); background: var(--entry); }
.pr-check-group button[aria-pressed="true"] { background: var(--primary); color: var(--theme); }

.pr-dict-word { padding: 0 0.15em; border-radius: 3px; }
.pr-dict-wrong { background: #ffe1e1; text-decoration: line-through; }
.pr-dict-missing { background: #fff2cc; border: 1px dashed #c9a227; min-width: 2em; display: inline-block; }
.pr-dict-extra { color: #999; text-decoration: line-through; }
:root[data-theme="dark"] .pr-dict-wrong,
:root:not([data-theme="light"]) .pr-dict-wrong { background: #5c2626; }
:root[data-theme="dark"] .pr-dict-missing,
:root:not([data-theme="light"]) .pr-dict-missing { background: #5c4e1a; border-color: #cbb44a; }

.practice-result-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.8rem;
  margin-top: 0.8rem;
}
.practice-result-grid .stat { background: var(--entry); border-radius: var(--radius); padding: 0.6rem 0.8rem; }
.practice-result-grid .stat .label { font-size: 0.8rem; color: var(--secondary); }
.practice-result-grid .stat .value { font-size: 1.3rem; font-weight: 700; }

@media (max-width: 640px) {
  .practice-tabs { gap: 0.3rem; }
  .practice-tab { padding: 0.3rem 0.6rem; font-size: 0.9rem; }
}
```

- [ ] **Step 4: Update `hugo.toml`**

Change `mainSections` (add under `[params]`, anywhere in that block):

```toml
  mainSections = ['practice']
```

Replace the `Posts` menu entry:

```toml
  [[menu.main]]
    identifier = 'practice'
    name = 'Practice'
    url = '/practice/'
    weight = 10
```

Replace `homeInfoParams` content to describe the new feature:

```toml
  [params.homeInfoParams]
    Title = 'Speaking Lab 🎤'
    Content = 'Paste a YouTube segment and practice it the way it was meant to be learned: timed silent reading, timed read-aloud with stress guidance, script-hidden listening, and review.'
```

- [ ] **Step 5: Verify the build runs (content is still empty, this only checks for template/config errors)**

Run: `hugo --minify 2>&1 | tail -20`
Expected: builds without error (0 pages under `/practice/` is fine — no content exists yet). A `template: ... practice/single.html: ... resources.Get` style error at this point most likely means the `[markup.goldmark.renderer] unsafe` block or `[outputs]` block was accidentally removed from `hugo.toml` — diff against git to check.

- [ ] **Step 6: Commit**

```bash
git add layouts/practice/single.html assets/css/extended/practice.css \
        content/practice/.gitkeep hugo.toml pipeline/state.json
git rm -r content/posts
git commit -m "feat: scaffold practice section layout, styles, and homepage copy"
```

## Task 4: `assets/js/practice/score.js` — word normalization and dictation scoring

**Files:**
- Create: `assets/js/practice/score.js`
- Test: `assets/js/practice/score.test.mjs`

**Interfaces:**
- Produces (used by Task 6, 9, 10): `normalizeWord(word: string) -> string`, `tokenize(text: string) -> string[]`, `scoreDictation(correctText: string, inputText: string) -> {ops: Array<{type: "match"|"wrong"|"missing"|"extra", correct?: string, said?: string}>, accuracy: number, matchCount: number, total: number}`.

- [ ] **Step 1: Write the failing tests**

Create `assets/js/practice/score.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWord, scoreDictation } from "./score.js";

test("normalizeWord strips case and punctuation, keeps internal apostrophe", () => {
  assert.equal(normalizeWord("Don't"), "don't");
  assert.equal(normalizeWord("Happiness,"), "happiness");
  assert.equal(normalizeWord("‘Quoted’"), "quoted");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd assets/js/practice && node --test score.test.mjs`
Expected: FAIL — `Cannot find module './score.js'`

- [ ] **Step 3: Write `assets/js/practice/score.js`**

```js
export function normalizeWord(word) {
  let w = word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "");
  w = w.replace(/(^|[^a-z0-9'])'+|'+([^a-z0-9']|$)/g, "$1$2");
  w = w.replace(/[^a-z0-9']/g, "");
  return w;
}

export function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * 단어 단위 편집 거리(비용 1)로 정답과 입력을 정렬해 각 위치를
 * match / wrong(대체) / missing(누락) / extra(추가)로 분류한다.
 */
export function scoreDictation(correctText, inputText) {
  const correct = tokenize(correctText).map(normalizeWord).filter(Boolean);
  const input = tokenize(inputText).map(normalizeWord).filter(Boolean);
  const n = correct.length;
  const m = input.length;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (correct[i - 1] === input[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && correct[i - 1] === input[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      ops.unshift({ type: "match", correct: correct[i - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.unshift({ type: "wrong", correct: correct[i - 1], said: input[j - 1] });
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.unshift({ type: "missing", correct: correct[i - 1] });
      i--;
    } else {
      ops.unshift({ type: "extra", said: input[j - 1] });
      j--;
    }
  }

  const matchCount = ops.filter((o) => o.type === "match").length;
  const accuracy = n === 0 ? 1 : matchCount / n;
  return { ops, accuracy, matchCount, total: n };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd assets/js/practice && node --test score.test.mjs`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add assets/js/practice/score.js assets/js/practice/score.test.mjs
git commit -m "feat: add dictation word-alignment scoring"
```

## Task 5: `assets/js/practice/markup.js` — stress, chunk, and dictation-result HTML

**Files:**
- Create: `assets/js/practice/markup.js`
- Test: `assets/js/practice/markup.test.mjs`

**Interfaces:**
- Consumes (from Task 4): nothing directly, but `renderDictationResult` renders the `ops` shape produced by `scoreDictation`.
- Produces (used by Task 11, 12 stage modules): `escapeHtml(s: string) -> string`, `renderStressedSentence(sentence: {words: Array<{w, strong, syl?, link}>}) -> string` (HTML), `renderChunks(sentence: {chunks: Array<{en, ko}>}) -> string` (HTML), `renderDictationResult(ops) -> string` (HTML).

- [ ] **Step 1: Write the failing tests**

Create `assets/js/practice/markup.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd assets/js/practice && node --test markup.test.mjs`
Expected: FAIL — `Cannot find module './markup.js'`

- [ ] **Step 3: Write `assets/js/practice/markup.js`**

```js
const ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function markupWord(word) {
  const escaped = escapeHtml(word.w);
  let inner = escaped;
  if (word.strong && word.syl) {
    const idx = escaped.toLowerCase().indexOf(word.syl.toLowerCase());
    if (idx >= 0) {
      inner =
        escaped.slice(0, idx) +
        `<span class="pr-syl">${escaped.slice(idx, idx + word.syl.length)}</span>` +
        escaped.slice(idx + word.syl.length);
    }
  }
  const classes = ["pr-word", word.strong ? "pr-strong" : "pr-weak"];
  if (word.link) classes.push("pr-link");
  return `<span class="${classes.join(" ")}">${inner}</span>`;
}

export function renderStressedSentence(sentence) {
  return sentence.words.map(markupWord).join(" ");
}

export function renderChunks(sentence) {
  return sentence.chunks
    .map(
      (c) =>
        `<span class="pr-chunk"><span class="pr-chunk-en">${escapeHtml(c.en)}</span>` +
        `<span class="pr-chunk-ko">${escapeHtml(c.ko)}</span></span>`
    )
    .join('<span class="pr-chunk-break">/</span> ');
}

export function renderDictationResult(ops) {
  return ops
    .map((op) => {
      if (op.type === "match") {
        return `<span class="pr-dict-word pr-dict-match">${escapeHtml(op.correct)}</span>`;
      }
      if (op.type === "wrong") {
        return (
          `<span class="pr-dict-word pr-dict-wrong" title="정답: ${escapeHtml(op.correct)}">` +
          `${escapeHtml(op.said)}</span>`
        );
      }
      if (op.type === "missing") {
        return `<span class="pr-dict-word pr-dict-missing">${escapeHtml(op.correct)}</span>`;
      }
      return `<span class="pr-dict-word pr-dict-extra">${escapeHtml(op.said)}</span>`;
    })
    .join(" ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd assets/js/practice && node --test markup.test.mjs`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add assets/js/practice/markup.js assets/js/practice/markup.test.mjs
git commit -m "feat: add stress/chunk/dictation HTML rendering"
```

## Task 6: `assets/js/practice/store.js` — localStorage attempt history

**Files:**
- Create: `assets/js/practice/store.js`
- Test: `assets/js/practice/store.test.mjs`

**Interfaces:**
- Produces (used by Task 12): `loadHistory(slug: string) -> {attempts: Array<object>}`, `todayCount(slug: string, today: string) -> number`, `saveAttempt(slug: string, attempt: {date: string, ...}) -> {attempts: Array<object>}`, `previousAttempt(slug: string) -> object | null`.

- [ ] **Step 1: Write the failing tests**

Create `assets/js/practice/store.test.mjs`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd assets/js/practice && node --test store.test.mjs`
Expected: FAIL — `Cannot find module './store.js'`

- [ ] **Step 3: Write `assets/js/practice/store.js`**

```js
const PREFIX = "speaking:practice:";
const MAX_ATTEMPTS = 20;

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 저장 실패(사생활 보호 모드 등)는 조용히 무시 — 실습 자체는 계속 동작해야 한다
  }
}

export function loadHistory(slug) {
  const raw = safeGet(PREFIX + slug);
  if (!raw) return { attempts: [] };
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.attempts) ? parsed : { attempts: [] };
  } catch {
    return { attempts: [] };
  }
}

export function todayCount(slug, today) {
  return loadHistory(slug).attempts.filter((a) => a.date === today).length;
}

export function saveAttempt(slug, attempt) {
  const history = loadHistory(slug);
  history.attempts.push(attempt);
  if (history.attempts.length > MAX_ATTEMPTS) {
    history.attempts = history.attempts.slice(-MAX_ATTEMPTS);
  }
  safeSet(PREFIX + slug, JSON.stringify(history));
  return history;
}

export function previousAttempt(slug) {
  const attempts = loadHistory(slug).attempts;
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd assets/js/practice && node --test store.test.mjs`
Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add assets/js/practice/store.js assets/js/practice/store.test.mjs
git commit -m "feat: add localStorage attempt history with safe fallbacks"
```

## Task 7: `assets/js/practice/player.js` — YouTube IFrame wrapper

**Files:**
- Create: `assets/js/practice/player.js`

This module only works against the real YouTube IFrame API in a browser — there is no meaningful way to unit-test it with `node --test` (it would just be testing a mock of YouTube's API, not this code). It is verified manually in Task 15, Step 4, alongside the other stages. Keep it small and let that manual pass be the test.

**Interfaces:**
- Consumes: global `window.YT` (loaded from `https://www.youtube.com/iframe_api`).
- Produces (used by Task 10, 11): `ensurePlayer(ctx: {data: {video_id: string}, player: object|null}, elementId: string) -> Promise<YT.Player>` (creates once, caches on `ctx.player`), `playRange(player: YT.Player, start: number, end: number, onEnd?: () => void) -> () => void` (returns a cleanup/cancel function).

- [ ] **Step 1: Write `assets/js/practice/player.js`**

```js
let apiReadyPromise = null;

function loadIframeApi() {
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (previous) previous();
      resolve(window.YT);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => reject(new Error("YouTube IFrame API 로드 실패"));
    document.head.appendChild(tag);
    setTimeout(() => reject(new Error("YouTube IFrame API 로드 타임아웃")), 10000);
  });
  return apiReadyPromise;
}

function createPlayer(elementId, videoId) {
  return loadIframeApi().then(
    (YT) =>
      new Promise((resolve, reject) => {
        const player = new YT.Player(elementId, {
          videoId,
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => resolve(player),
            onError: (e) => reject(new Error(`YouTube 재생 오류 (코드 ${e.data})`)),
          },
        });
      })
  );
}

/** ctx.player가 없으면 한 번만 만들어 캐시하고, 있으면 그대로 돌려준다. */
export async function ensurePlayer(ctx, elementId) {
  if (ctx.player) return ctx.player;
  ctx.player = await createPlayer(elementId, ctx.data.video_id);
  return ctx.player;
}

/** start~end 구간을 재생하고 end에 도달하면 멈춘 뒤 onEnd를 부른다 (100ms 폴링). */
export function playRange(player, start, end, onEnd) {
  player.seekTo(start, true);
  player.playVideo();
  const timer = setInterval(() => {
    if (player.getCurrentTime() >= end) {
      clearInterval(timer);
      player.pauseVideo();
      if (onEnd) onEnd();
    }
  }, 100);
  return () => clearInterval(timer);
}
```

- [ ] **Step 2: Commit**

```bash
git add assets/js/practice/player.js
git commit -m "feat: add YouTube IFrame player wrapper for segment/sentence playback"
```

## Task 8: `assets/js/practice/speech.js` — recording and speech recognition

**Files:**
- Create: `assets/js/practice/speech.js`

Same situation as Task 7: this wraps `MediaRecorder` and `SpeechRecognition`, both real-browser-only APIs with no faithful Node equivalent. Verified manually in Task 15, Step 4 — specifically call out in that step that mic/recognition may not be testable from this session's own browser tooling, per spec §8, and ask the user to confirm that part themselves.

**Interfaces:**
- Produces (used by Task 11): `isRecordingSupported() -> boolean`, `isSpeechRecognitionSupported() -> boolean`, `startRecording() -> Promise<{stop: () => Promise<string>}>` (the resolved `stop()` value is an object-URL for the recorded audio), `startRecognition(onUpdate: (text: string) => void) -> {stop: () => string} | null` (returns `null` immediately if unsupported, matching `isSpeechRecognitionSupported()`).

- [ ] **Step 1: Write `assets/js/practice/speech.js`**

```js
export function isSpeechRecognitionSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isRecordingSupported() {
  return typeof window !== "undefined" && !!(window.MediaRecorder && navigator.mediaDevices);
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(URL.createObjectURL(new Blob(chunks, { type: "audio/webm" })));
        };
        recorder.stop();
      }),
  };
}

/**
 * 녹음 중 침묵으로 인식이 끊겨도(onend) 자동 재시작하며 누적 transcript를
 * onUpdate로 계속 보고한다. 미지원 브라우저에서는 null을 돌려준다.
 */
export function startRecognition(onUpdate) {
  if (!isSpeechRecognitionSupported()) return null;
  const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Impl();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  let finalText = "";
  let stopped = false;

  recognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += `${e.results[i][0].transcript} `;
    }
    onUpdate(finalText.trim());
  };
  recognition.onend = () => {
    if (!stopped) recognition.start();
  };
  recognition.start();

  return {
    stop: () => {
      stopped = true;
      recognition.stop();
      return finalText.trim();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add assets/js/practice/speech.js
git commit -m "feat: add recording and speech-recognition wrappers"
```

## Task 9: `assets/js/practice/timer.js` — countdown, stopwatch, formatting

**Files:**
- Create: `assets/js/practice/timer.js`
- Test: `assets/js/practice/timer.test.mjs`

Split out from the stage shell so it has zero dependency on the stage modules — Task 10/11 (stages) and Task 12 (shell) both import it, and without this split they'd import each other in a circle.

**Interfaces:**
- Produces (used by Task 10, 11, 12): `startCountdown(seconds: number, {onTick: (remaining: number) => void, onDone: () => void}) -> () => void` (cancel function), `startStopwatch(onTick: (elapsedSeconds: number) => void) -> {stop: () => number}` (`stop()` returns final elapsed seconds), `formatSeconds(seconds: number) -> string` (`"m:ss"`).

- [ ] **Step 1: Write the failing tests**

Create `assets/js/practice/timer.test.mjs`:

```js
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
```

Note: `startStopwatch` is not unit-tested here because it reads `performance.now()`, which Node provides but whose real-time behavior makes a deterministic test not worth the complexity for a one-line wrapper — it is covered by the Task 15 manual walkthrough instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd assets/js/practice && node --test timer.test.mjs`
Expected: FAIL — `Cannot find module './timer.js'`

- [ ] **Step 3: Write `assets/js/practice/timer.js`**

```js
export function formatSeconds(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 1초 간격으로 내려가며 onTick(remaining)을 부르고, 0에서 onDone()을 부른다. */
export function startCountdown(seconds, { onTick, onDone }) {
  let remaining = seconds;
  onTick(remaining);
  const timer = setInterval(() => {
    remaining -= 1;
    onTick(Math.max(remaining, 0));
    if (remaining <= 0) {
      clearInterval(timer);
      onDone();
    }
  }, 1000);
  return () => clearInterval(timer);
}

/** performance.now() 기준 스톱워치. onTick(elapsedSeconds)을 100ms마다 부른다. */
export function startStopwatch(onTick) {
  const startedAt = performance.now();
  const timer = setInterval(() => onTick((performance.now() - startedAt) / 1000), 100);
  return {
    stop: () => {
      clearInterval(timer);
      return (performance.now() - startedAt) / 1000;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd assets/js/practice && node --test timer.test.mjs`
Expected: all 3 tests PASS (the second and third take a couple of seconds — that is expected, they exercise real timers)

- [ ] **Step 5: Commit**

```bash
git add assets/js/practice/timer.js assets/js/practice/timer.test.mjs
git commit -m "feat: add countdown/stopwatch timer utilities"
```

## Task 10: `assets/js/practice/stage1.js` + `stage2.js` — reading and read-aloud stages

**Files:**
- Create: `assets/js/practice/stage1.js`
- Create: `assets/js/practice/stage2.js`

Both stages are DOM-heavy and depend on real timers, so they are verified manually (Task 15, Step 4), not with `node --test`. The logic each one owns that *is* independently testable (dictation scoring, stress rendering, timer math) is already covered by Tasks 4, 5, 9.

**Interfaces:**
- Consumes (from Task 4, 5, 7, 8, 9): `scoreDictation` (Task 4), `renderChunks`, `renderStressedSentence` (Task 5), `ensurePlayer`, `playRange` (Task 7, used by `stage2.js`'s per-sentence 원음 buttons), `isRecordingSupported`, `startRecording`, `isSpeechRecognitionSupported`, `startRecognition` (Task 8), `startCountdown`, `startStopwatch`, `formatSeconds` (Task 9).
- Produces (used by Task 12): `mountStage1(panel: HTMLElement, ctx) -> void`, `mountStage2(panel: HTMLElement, ctx) -> void`. Both read `ctx.data` (the parsed `data.json`) and write their outcome onto `ctx.results.stage1` / `ctx.results.stage2`.
- `ctx.results.stage1` shape written: `{understood: number, total: number, elapsedSeconds: number}`.
- `ctx.results.stage2` shape written: `{elapsedSeconds: number, targetSeconds: number, withinTarget: boolean, recognitionAccuracy: number|null}`.

- [ ] **Step 1: Write `assets/js/practice/stage1.js`**

```js
import { renderChunks } from "./markup.js";
import { startCountdown, formatSeconds } from "./timer.js";

export function mountStage1(panel, ctx) {
  const { data } = ctx;
  const seconds = Math.ceil(data.segment.end - data.segment.start);
  const startedAt = performance.now();

  panel.innerHTML = `
    <p>이 구간은 ${seconds}초입니다. [시작]을 누르면 그 시간 안에 스크립트를 끝까지 읽어보세요.</p>
    <button class="pr-start" type="button">시작</button>
    <div class="practice-timer" hidden></div>
    <div class="pr-script" hidden></div>
    <button class="pr-done" type="button" hidden>다 읽었다</button>
    <div class="pr-check" hidden></div>
    <div class="practice-result-grid" hidden></div>
  `;

  const startBtn = panel.querySelector(".pr-start");
  const timerEl = panel.querySelector(".practice-timer");
  const scriptEl = panel.querySelector(".pr-script");
  const doneBtn = panel.querySelector(".pr-done");
  const checkEl = panel.querySelector(".pr-check");
  const resultEl = panel.querySelector(".practice-result-grid");

  scriptEl.innerHTML = data.sentences
    .map((s, i) => `<p class="pr-sentence-row" data-i="${i}">${renderChunks(s)}</p>`)
    .join("");

  let cancelCountdown = null;

  startBtn.addEventListener("click", () => {
    startBtn.hidden = true;
    timerEl.hidden = false;
    scriptEl.hidden = false;
    doneBtn.hidden = false;
    cancelCountdown = startCountdown(seconds, {
      onTick: (r) => {
        timerEl.textContent = formatSeconds(r);
      },
      onDone: () => finish(seconds),
    });
  });

  doneBtn.addEventListener("click", () => {
    finish((performance.now() - startedAt) / 1000);
  });

  function finish(elapsed) {
    if (cancelCountdown) cancelCountdown();
    doneBtn.hidden = true;
    scriptEl.classList.add("pr-blurred");
    checkEl.hidden = false;
    checkEl.innerHTML =
      data.sentences
        .map(
          (s, i) => `
      <div class="pr-sentence-row" data-i="${i}">
        <p>${s.text}</p>
        <div class="pr-check-group" data-i="${i}">
          <button type="button" data-v="ok">이해됨</button>
          <button type="button" data-v="stuck">막힘</button>
        </div>
      </div>`
        )
        .join("") + '<button class="pr-reveal" type="button">뜻 보기</button>';

    checkEl.querySelectorAll(".pr-check-group button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.parentElement;
        group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        group.dataset.value = btn.dataset.v;
      });
    });

    checkEl.querySelector(".pr-reveal").addEventListener("click", () => {
      scriptEl.classList.remove("pr-blurred");
      checkEl.querySelector(".pr-reveal").hidden = true;
      const understood = [...checkEl.querySelectorAll(".pr-check-group")].filter(
        (g) => g.dataset.value === "ok"
      ).length;
      ctx.results.stage1 = {
        understood,
        total: data.sentences.length,
        elapsedSeconds: Math.round(elapsed),
      };
      resultEl.hidden = false;
      resultEl.innerHTML = `
        <div class="stat"><div class="label">이해한 문장</div><div class="value">${understood}/${data.sentences.length}</div></div>
        <div class="stat"><div class="label">걸린 시간</div><div class="value">${formatSeconds(elapsed)}</div></div>
      `;
    });
  }
}
```

- [ ] **Step 2: Write `assets/js/practice/stage2.js`**

```js
import { renderStressedSentence } from "./markup.js";
import { startStopwatch, formatSeconds } from "./timer.js";
import { ensurePlayer, playRange } from "./player.js";
import {
  isRecordingSupported,
  startRecording,
  isSpeechRecognitionSupported,
  startRecognition,
} from "./speech.js";
import { scoreDictation } from "./score.js";

export function mountStage2(panel, ctx) {
  const { data } = ctx;
  const targetSeconds = Math.ceil(data.segment.end - data.segment.start);
  const fullText = data.sentences.map((s) => s.text).join(" ");

  panel.innerHTML = `
    <div id="pr-yt-stage2" class="pr-hidden-player"></div>
    <div class="pr-player-notice" hidden></div>
    <div class="pr-script">
      ${data.sentences
        .map(
          (s, i) =>
            `<p class="pr-sentence-row" data-i="${i}">
               <button type="button" class="pr-play-original" data-i="${i}">원음</button>
               ${renderStressedSentence(s)}${s.tip ? `<br><small>${s.tip}</small>` : ""}
             </p>`
        )
        .join("")}
    </div>
    <p>목표 시간: ${formatSeconds(targetSeconds)}</p>
    <button class="pr-record" type="button">녹음 시작</button>
    <div class="practice-timer" hidden></div>
    <div class="practice-result-grid" hidden></div>
    <audio class="pr-playback" controls hidden></audio>
  `;

  const recordBtn = panel.querySelector(".pr-record");
  const timerEl = panel.querySelector(".practice-timer");
  const resultEl = panel.querySelector(".practice-result-grid");
  const audioEl = panel.querySelector(".pr-playback");
  const playerNotice = panel.querySelector(".pr-player-notice");

  // 원음 버튼: 플레이어 로드/재생 오류가 나도 녹음·타이머 기능은 그대로 쓸 수 있어야 한다
  // (spec §7 "YouTube API 로드 실패 → 재생 의존 기능만 비활성, 나머지는 동작").
  panel.querySelectorAll(".pr-play-original").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const s = data.sentences[Number(btn.dataset.i)];
      btn.disabled = true;
      try {
        const player = await ensurePlayer(ctx, "pr-yt-stage2");
        playRange(player, s.start, s.end, () => {
          btn.disabled = false;
        });
      } catch (err) {
        btn.disabled = true;
        btn.textContent = "원음 재생 불가";
        playerNotice.hidden = false;
        playerNotice.textContent = `원음을 불러올 수 없습니다 (${err.message}) — 녹음·타이머는 계속 사용할 수 있습니다.`;
      }
    });
  });

  if (!isRecordingSupported()) {
    recordBtn.disabled = true;
    recordBtn.insertAdjacentHTML(
      "afterend",
      "<p>이 브라우저는 녹음을 지원하지 않습니다 — 목표 시간만 참고하세요.</p>"
    );
    return;
  }

  recordBtn.addEventListener("click", onRecordClick);

  async function onRecordClick() {
    recordBtn.disabled = true;
    timerEl.hidden = false;

    let recognizedText = "";
    const recognition = isSpeechRecognitionSupported()
      ? startRecognition((t) => {
          recognizedText = t;
        })
      : null;
    const recording = await startRecording();
    const stopwatch = startStopwatch((t) => {
      timerEl.textContent = formatSeconds(t);
    });

    recordBtn.textContent = "끝";
    recordBtn.disabled = false;
    recordBtn.removeEventListener("click", onRecordClick);
    recordBtn.addEventListener("click", async () => {
      recordBtn.disabled = true;
      const elapsed = stopwatch.stop();
      const finalText = recognition ? recognition.stop() : "";
      const url = await recording.stop();
      audioEl.src = url;
      audioEl.hidden = false;

      const ratio = elapsed / targetSeconds;
      const accuracy = finalText ? scoreDictation(fullText, finalText).accuracy : null;
      ctx.results.stage2 = {
        elapsedSeconds: Math.round(elapsed),
        targetSeconds,
        withinTarget: ratio <= 1.15,
        recognitionAccuracy: accuracy,
      };
      resultEl.hidden = false;
      resultEl.innerHTML = `
        <div class="stat"><div class="label">내 시간</div><div class="value">${formatSeconds(elapsed)}</div></div>
        <div class="stat"><div class="label">목표 대비</div><div class="value">${
          ratio <= 1.15 ? "통과" : `${Math.round(ratio * 100)}%`
        }</div></div>
        ${
          accuracy !== null
            ? `<div class="stat"><div class="label">인식률</div><div class="value">${Math.round(
                accuracy * 100
              )}%</div></div>`
            : ""
        }
      `;
      recordBtn.textContent = "다시 녹음 (새로고침)";
      recordBtn.disabled = false;
      recordBtn.onclick = () => location.reload();
    });
  }
}
```

`recordBtn`'s "다시 녹음" reloads the page rather than resetting in-place state — the simplest correct behavior for a retry, matching the spec's YAGNI stance; a smoother in-place reset can be added later if it turns out to matter.

- [ ] **Step 3: Commit**

```bash
git add assets/js/practice/stage1.js assets/js/practice/stage2.js
git commit -m "feat: add stage 1 (timed reading) and stage 2 (timed read-aloud)"
```

## Task 11: `assets/js/practice/stage3.js` + `stage4.js` — listening and review stages

**Files:**
- Create: `assets/js/practice/stage3.js`
- Create: `assets/js/practice/stage4.js`

Same testing note as Task 10 — DOM/player-heavy, verified manually in Task 15, Step 4.

**Interfaces:**
- Consumes (from Task 4, 5, 7): `scoreDictation` (Task 4), `renderStressedSentence`, `renderDictationResult` (Task 5), `ensurePlayer`, `playRange` (Task 7).
- Produces (used by Task 12): `mountStage3(panel, ctx) -> void`, `mountStage4(panel, ctx) -> void`. `mountStage4` additionally reads `ctx.results`, `ctx.previousAttempt`, `ctx.attemptNumber`, and calls `ctx.recordAttempt()` on restart.
- `ctx.results.stage3` shape written: `{questionScore: number, questionTotal: number, dictationAccuracy: number|undefined}` (`dictationAccuracy` is set once all sentences have been checked).

- [ ] **Step 1: Write `assets/js/practice/stage3.js`**

```js
import { ensurePlayer, playRange } from "./player.js";
import { renderStressedSentence, renderDictationResult } from "./markup.js";
import { scoreDictation } from "./score.js";

export function mountStage3(panel, ctx) {
  const { data } = ctx;
  panel.innerHTML = `
    <div class="practice-player-wrap">
      <div id="pr-yt-stage3"></div>
      <div class="practice-cover">듣기에 집중하세요 (화면 가림)</div>
    </div>
    <div class="pr-player-notice" hidden></div>
    <div class="pr-stage3a">
      <button class="pr-listen-all" type="button">전체 듣기</button>
      <span class="pr-play-count">0회 재생</span>
      <div class="pr-questions" hidden></div>
    </div>
    <div class="pr-stage3b" hidden></div>
  `;

  let playCount = 0;
  const playCountEl = panel.querySelector(".pr-play-count");
  const listenAllBtn = panel.querySelector(".pr-listen-all");
  const questionsEl = panel.querySelector(".pr-questions");
  const playerNotice = panel.querySelector(".pr-player-notice");

  // 플레이어 로드/재생 오류를 사용자에게 보여주고, 재생 버튼만 계속 비활성화한다
  // (spec §7 "재생 의존 기능만 비활성, 나머지는 동작"). 실패해도 예외가 새지 않는다.
  async function safeEnsurePlayer(elementId) {
    try {
      return await ensurePlayer(ctx, elementId);
    } catch (err) {
      playerNotice.hidden = false;
      playerNotice.textContent = `영상을 불러올 수 없습니다 (${err.message}) — 재생 관련 기능만 사용할 수 없습니다.`;
      return null;
    }
  }

  listenAllBtn.addEventListener("click", async () => {
    listenAllBtn.disabled = true;
    const player = await safeEnsurePlayer("pr-yt-stage3");
    if (!player) {
      listenAllBtn.disabled = true;
      listenAllBtn.textContent = "재생 불가";
      return;
    }
    playRange(player, data.segment.start, data.segment.end, () => {
      listenAllBtn.disabled = false;
      playCount += 1;
      playCountEl.textContent = `${playCount}회 재생`;
      if (playCount === 1) showQuestions();
    });
  });

  function showQuestions() {
    questionsEl.hidden = false;
    questionsEl.innerHTML =
      data.questions
        .map(
          (q, qi) => `
      <div class="pr-question" data-qi="${qi}">
        <p>${q.q}</p>
        ${q.options
          .map((opt, oi) => `<label><input type="radio" name="q${qi}" value="${oi}"> ${opt}</label><br>`)
          .join("")}
      </div>`
        )
        .join("") + '<button class="pr-grade" type="button">채점</button>';

    questionsEl.querySelector(".pr-grade").addEventListener("click", () => {
      let correctCount = 0;
      data.questions.forEach((q, qi) => {
        const picked = questionsEl.querySelector(`input[name="q${qi}"]:checked`);
        const qEl = questionsEl.querySelector(`.pr-question[data-qi="${qi}"]`);
        const isCorrect = picked && Number(picked.value) === q.answer;
        if (isCorrect) correctCount += 1;
        qEl.insertAdjacentHTML(
          "beforeend",
          `<p class="pr-answer-note">${isCorrect ? "✅" : "❌"} ${q.options[q.answer]} — ${q.why}</p>`
        );
      });
      ctx.results.stage3 = { questionScore: correctCount, questionTotal: data.questions.length };
      startDictation();
    });
  }

  function startDictation() {
    const section = panel.querySelector(".pr-stage3b");
    section.hidden = false;
    section.innerHTML = data.sentences
      .map(
        (s, i) => `
      <div class="pr-sentence-row" data-i="${i}">
        <button class="pr-listen-one" type="button" data-i="${i}">듣기</button>
        <input type="text" class="pr-dict-input" data-i="${i}" placeholder="들은 대로 입력">
        <button class="pr-check-dict" type="button" data-i="${i}">확인</button>
        <div class="pr-dict-result"></div>
      </div>`
      )
      .join("");

    section.querySelectorAll(".pr-listen-one").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const s = data.sentences[Number(btn.dataset.i)];
        const player = await safeEnsurePlayer("pr-yt-stage3");
        if (player) playRange(player, s.start, s.end);
      });
    });

    const accuracies = [];
    section.querySelectorAll(".pr-check-dict").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        const s = data.sentences[i];
        const row = section.querySelector(`.pr-sentence-row[data-i="${i}"]`);
        const input = row.querySelector(".pr-dict-input").value;
        const { ops, accuracy } = scoreDictation(s.text, input);
        accuracies.push(accuracy);

        const resultEl = row.querySelector(".pr-dict-result");
        resultEl.innerHTML = `
          <p>${renderDictationResult(ops)}</p>
          <p>${renderStressedSentence(s)}</p>
          <button type="button" class="pr-replay" data-i="${i}">다시 듣기</button>
        `;
        resultEl.querySelector(".pr-replay").addEventListener("click", async () => {
          const player = await safeEnsurePlayer("pr-yt-stage3");
          if (player) playRange(player, s.start, s.end);
        });

        if (accuracies.length === data.sentences.length) {
          const avg = accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
          ctx.results.stage3.dictationAccuracy = avg;
        }
      });
    });
  }
}
```

- [ ] **Step 2: Write `assets/js/practice/stage4.js`**

```js
import { renderStressedSentence, renderChunks } from "./markup.js";

export function mountStage4(panel, ctx) {
  const { data, results, previousAttempt, attemptNumber } = ctx;

  panel.innerHTML = `
    <p>오늘 ${attemptNumber}회째 시도입니다.</p>
    <div class="pr-full-script">
      ${data.sentences
        .map(
          (s) => `
        <div class="pr-sentence-row">
          <p>${renderStressedSentence(s)}</p>
          ${renderChunks(s)}
          ${s.tip ? `<p><small>${s.tip}</small></p>` : ""}
        </div>`
        )
        .join("")}
    </div>
    <h3>어휘</h3>
    <ul>
      ${data.vocab
        .map((v) => `<li><strong>${v.term}</strong> — ${v.ko} <small>${v.note || ""}</small></li>`)
        .join("")}
    </ul>
    <h3>이번 결과</h3>
    <div class="practice-result-grid" id="pr-summary"></div>
    <button class="pr-restart" type="button">다시 하기</button>
  `;

  const summaryEl = panel.querySelector("#pr-summary");
  const rows = [];
  if (results.stage1) rows.push(["직독직해 이해", `${results.stage1.understood}/${results.stage1.total}`]);
  if (results.stage2) rows.push(["낭독 시간", results.stage2.withinTarget ? "통과" : `${results.stage2.elapsedSeconds}초`]);
  if (results.stage3) rows.push(["듣기 점수", `${results.stage3.questionScore}/${results.stage3.questionTotal}`]);
  if (results.stage3 && results.stage3.dictationAccuracy != null) {
    rows.push(["받아쓰기 일치율", `${Math.round(results.stage3.dictationAccuracy * 100)}%`]);
  }
  summaryEl.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
    )
    .join("");

  if (previousAttempt) {
    summaryEl.insertAdjacentHTML(
      "beforebegin",
      `<p>직전 시도: ${previousAttempt.date} — 이해 ${previousAttempt.stage1 ? previousAttempt.stage1.understood : "-"}/${data.sentences.length}</p>`
    );
  }

  panel.querySelector(".pr-restart").addEventListener("click", () => {
    ctx.recordAttempt();
    location.reload();
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add assets/js/practice/stage3.js assets/js/practice/stage4.js
git commit -m "feat: add stage 3 (hidden-script listening) and stage 4 (review)"
```

## Task 12: `assets/js/practice/stages.js` + `main.js` — shell and entry point

**Files:**
- Create: `assets/js/practice/stages.js`
- Create: `assets/js/practice/main.js`

This wires every previous JS task together into the page; it is the piece Task 15's manual walkthrough actually exercises end-to-end, so there is no separate unit test here beyond what Tasks 4–9 already cover.

**Interfaces:**
- Consumes: `mountStage1` (Task 10), `mountStage2` (Task 10), `mountStage3` (Task 11), `mountStage4` (Task 11), `loadHistory`, `saveAttempt`, `todayCount`, `previousAttempt` (Task 6).
- Produces: `initPractice(root: HTMLElement, data: object, slug: string) -> ctx` where `ctx = {data, slug, player: null, results: {}, recordAttempt, previousAttempt, attemptNumber}`. Reads `#practice-data` and `#practice-root` (the two ids fixed by Task 3's layout) via `main.js`.

- [ ] **Step 1: Write `assets/js/practice/stages.js`**

```js
import { saveAttempt, todayCount, previousAttempt as getPreviousAttempt } from "./store.js";
import { mountStage1 } from "./stage1.js";
import { mountStage2 } from "./stage2.js";
import { mountStage3 } from "./stage3.js";
import { mountStage4 } from "./stage4.js";

const STAGES = [
  { id: "stage1", label: "1 직독직해", mount: mountStage1 },
  { id: "stage2", label: "2 낭독", mount: mountStage2 },
  { id: "stage3", label: "3 가리고 듣기", mount: mountStage3 },
  { id: "stage4", label: "4 정리", mount: mountStage4 },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function initPractice(root, data, slug) {
  const ctx = { data, slug, player: null, results: {} };

  const tabs = document.createElement("div");
  tabs.className = "practice-tabs";
  const panels = document.createElement("div");
  panels.className = "practice-panels";
  root.append(tabs, panels);

  const panelEls = {};
  const tabEls = {};
  STAGES.forEach((stage, i) => {
    const tab = document.createElement("button");
    tab.className = "practice-tab";
    tab.type = "button";
    tab.textContent = stage.label;
    tab.dataset.stageId = stage.id;
    tab.setAttribute("aria-selected", String(i === 0));
    tab.addEventListener("click", () => showStage(stage.id));
    tabs.appendChild(tab);
    tabEls[stage.id] = tab;

    const panel = document.createElement("div");
    panel.className = "practice-panel";
    panel.dataset.active = String(i === 0);
    panels.appendChild(panel);
    panelEls[stage.id] = panel;
  });

  const mounted = new Set();
  function showStage(id) {
    STAGES.forEach((s) => {
      const isActive = s.id === id;
      panelEls[s.id].dataset.active = String(isActive);
      tabEls[s.id].setAttribute("aria-selected", String(isActive));
    });
    if (!mounted.has(id)) {
      mounted.add(id);
      STAGES.find((s) => s.id === id).mount(panelEls[id], ctx);
    }
  }
  showStage(STAGES[0].id);

  ctx.recordAttempt = () => {
    try {
      saveAttempt(slug, { date: todayISO(), ...ctx.results });
    } catch {
      // 저장 실패는 조용히 무시 — 실습 흐름을 막지 않는다 (store.js 자체도 방어하지만 이중 방어)
    }
  };
  ctx.previousAttempt = getPreviousAttempt(slug);
  ctx.attemptNumber = todayCount(slug, todayISO()) + 1;

  return ctx;
}
```

- [ ] **Step 2: Write `assets/js/practice/main.js`**

```js
import { initPractice } from "./stages.js";

const dataEl = document.getElementById("practice-data");
const root = document.getElementById("practice-root");

if (dataEl && root) {
  const data = JSON.parse(dataEl.textContent);
  const slug = location.pathname.replace(/\/$/, "").split("/").pop();
  initPractice(root, data, slug);
} else {
  console.warn("practice: #practice-data or #practice-root missing — page has no practice content");
}
```

- [ ] **Step 3: Commit**

```bash
git add assets/js/practice/stages.js assets/js/practice/main.js
git commit -m "feat: wire practice stage shell and page entry point"
```

## Task 13: `.github/workflows/daily.yml` — CI updates

**Files:**
- Modify: `.github/workflows/daily.yml`

**Interfaces:**
- Consumes: `pipeline/test_transcript.py`, `pipeline/test_generate.py` (Task 1, 2), `assets/js/practice/*.test.mjs` (Task 4, 5, 6, 9).
- No new interfaces produced — this only changes when/how the existing `generate` and `deploy` jobs run.

- [ ] **Step 1: Remove the daily cron trigger**

The current file has (near the top):

```yaml
on:
  schedule:
    - cron: "0 22 * * *" # UTC 22:00 = KST 07:00 fallback for days with no transcript input
  workflow_dispatch:
  push: # input/ 저장(커밋) 시 즉시 생성+배포(후킹), 사이트 파일 변경 시 배포
    branches: [main]
    paths:
      - "input/**"
      - "content/**"
      - "hugo.toml"
      - "archetypes/**"
      - "assets/**"
```

Replace with (drop `schedule`, widen `paths` to cover the pipeline/layout/workflow files this plan changes, per spec §9):

```yaml
on:
  workflow_dispatch:
  push: # input/ 저장(커밋) 시 즉시 생성+배포(후킹), 사이트/파이프라인 파일 변경 시 배포
    branches: [main]
    paths:
      - "input/**"
      - "content/**"
      - "hugo.toml"
      - "archetypes/**"
      - "assets/**"
      - "layouts/**"
      - "pipeline/**"
      - ".github/workflows/**"
```

Also rename the workflow (first line of the file):

```yaml
name: Practice Pipeline
```

- [ ] **Step 2: Add a test step before generation, in the `generate` job**

The current `generate` job has, in order: `actions/checkout@v4`, `actions/setup-python@v5`, "Install dependencies", "Install Claude Code CLI", "Generate today's post". Insert a Node setup and a test step between "Install Claude Code CLI" and "Generate today's post":

```yaml
      - uses: actions/setup-node@v4
        with:
          node-version: "24"

      - name: Run tests
        run: |
          cd pipeline && python3 -m unittest discover -p "test_*.py" -v
          cd ../assets/js/practice && node --test
```

- [ ] **Step 3: Make "Generate today's post" depend on tests passing**

The "Generate today's post" step currently has `continue-on-error: true` so a Claude failure doesn't block `deploy`. Leave that as-is, but the new "Run tests" step must NOT have `continue-on-error` — a test failure should stop the job outright (no `continue-on-error`, default `fail-fast` behavior applies), which in turn skips "Generate today's post" and "Commit new post", and the `deploy` job's `needs: generate` means deploy does not run either since the job failed before `outputs.changed` could be set in a normal way. Confirm this by reading the full job after editing — `continue-on-error: true` must still be present only on "Generate today's post", not on "Run tests".

- [ ] **Step 4: Update the commit step's `git add` path**

Current:

```yaml
          git add content/posts pipeline/state.json input/script.md
```

Replace with:

```yaml
          git add content/practice pipeline/state.json input/script.md
```

- [ ] **Step 5: Verify the YAML is well-formed**

Run: `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/daily.yml'))" 2>&1 || python3 -c "import json,sys; print('no pyyaml, skipping — will validate on push via GitHub Actions')"`
Expected: no parse error (if `pyyaml` isn't installed locally, the actual validation happens when GitHub Actions parses it on push in Task 15 — note that in the step output rather than installing a new dependency just for this check).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/daily.yml
git commit -m "ci: run pipeline/JS tests before generating, drop daily cron, widen push paths"
```

## Task 14: `README.md` + `input/script.md` — copy for the new input format

**Files:**
- Modify: `README.md` (full rewrite — the current copy describes the idiom/vocab pipeline end-to-end, which no longer exists)
- Modify: `input/script.md` (replace the HTML-comment instructions and the empty code block's example content)

**Interfaces:** none — this is documentation only, read by a human in the GitHub UI.

- [ ] **Step 1: Replace `README.md`**

````markdown
# Speaking Lab (speaking)

유튜브 영상 구간을 붙여넣으면, 그 구간으로 직독직해 → 낭독 → 가리고 듣기 → 정리
4단계 실습 페이지를 자동으로 만들어 주는 사이트.

사이트: https://speaking.metacog.co.kr/

## 어떻게 동작하나

```
input/script.md (유튜브 URL + 스크립트 패널 복붙, GitHub 웹 UI에서 편집)
        │
        ▼  저장(커밋)하는 순간 push 후킹으로 즉시 실행
pipeline/transcript.py  URL·타임스탬프 파싱, 구간 길이 계산, 문장별 재생 시각 정렬
pipeline/generate.py
  - Claude가 자막 조각을 문장으로 정리해 의미 덩어리 뜻·강세 표기·이해 문제·어휘 생성
    (시각은 Claude가 아니라 transcript.py가 계산)
  - content/practice/YYYY-MM-DD-<제목>/{index.md,data.json} 로 저장
        │
        ▼  변경사항 커밋 & push
Hugo build → GitHub Pages 배포
```

실습 페이지 자체(4단계 UI, 타이머, 녹음, 음성인식, 받아쓰기 채점)는
`assets/js/practice/`의 순수 JS로 브라우저에서 동작한다 — 서버나 계정 없이
결과는 브라우저 `localStorage`에만 남는다.

## 사용하는 방법

1. GitHub 저장소에서 [`input/script.md`](input/script.md) 파일을 연다.
   (블로그 상단 "Add Transcript ✏️" 버튼으로 바로 이동 가능)
2. 연필(✏️) 아이콘을 눌러 편집 모드로 들어간다.
3. 코드블록(```) 안에 **첫 줄에 유튜브 URL**, 그다음 유튜브 "스크립트 표시"에서
   복사한 구간(타임스탬프 포함)을 그대로 붙여넣는다. 구간은 20~60초 정도가
   적당하고 180초를 넘으면 처리되지 않는다. 여러 구간을 한꺼번에 넣으려면
   `---` 만 있는 줄로 구분한다.
4. 우측 상단 "Commit changes"로 저장한다. **저장하는 순간 GitHub Actions가
   후킹되어 즉시 분석·게시가 시작된다.**
5. 몇 분 뒤 사이트에 새 실습 페이지가 올라온다.

게시가 전부 성공하면 파이프라인이 커밋 시 `input/script.md` 코드블록을 자동으로
비운다. 일부만 실패하면 재시도할 수 있도록 입력은 그대로 남는다. Actions 탭 →
"Practice Pipeline" → "Run workflow"로 수동 실행도 가능하다.

### 개인정보 보호

- **게시물**: `pipeline/generate.py`의 프롬프트가 실명 등 개인을 특정할 수 있는
  정보를 자동으로 일반화한다.
- **원본 커밋**: 이 저장소가 public이라면, 붙여넣은 원문 자체는 커밋하는 순간
  공개된다. 다만 유튜브 자막은 대개 화자 실명을 포함하지 않으므로 이디엄 버전만큼
  민감하지는 않다. 혹시 영상에 개인을 특정할 수 있는 내용이 있다면 붙여넣기 전에
  지우는 것을 권장한다.

### 입력이 없는 날

이 파이프라인은 후킹 전용이다 — 실습은 영상이 있어야 성립하므로, 입력이 비어
있으면 그날은 아무것도 게시하지 않고 조용히 종료한다 (매일 자동 게시되던 이전
이디엄 폴백은 없다).

## 최초 설정 (1회만, 사람이 직접 해야 하는 단계)

자동 생성 단계는 Claude Code CLI를 사용한다. GitHub Actions에서 이 CLI를 인증하려면
Claude 구독 계정으로 발급한 OAuth 토큰을 저장소 Secret으로 등록해야 한다. 이 과정은
브라우저 로그인이 필요해 에이전트가 대신할 수 없다.

```bash
claude setup-token
```

터미널에 표시되는 인증 코드를 브라우저에 붙여넣고 로그인하면, **그 다음에** 터미널에
`sk-ant-oat01-...` 로 시작하는 토큰이 출력된다.

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo jeonck/speaking
# 위 토큰을 붙여넣기
```

등록 후 Actions 탭에서 워크플로를 한 번 수동 실행(`workflow_dispatch`)해 정상 동작을
확인한다.

## 저장소 구조

| 경로 | 역할 |
|---|---|
| `input/script.md` | 유튜브 URL + 스크립트 붙여넣는 곳 (사람이 수정 — 저장 즉시 후킹 실행) |
| `pipeline/transcript.py` | URL·타임스탬프 파싱, 구간 계산, 문장-자막 타이밍 정렬 (순수 함수) |
| `pipeline/generate.py` | Claude 호출·검증 → `content/practice/` 페이지 번들 작성. 도메인 설정은 파일 상단 "도메인 설정" 블록 |
| `pipeline/state.json` | 게시에 사용된 구간 해시 목록 (중복 게시 방지) |
| `content/practice/` | 생성된 실습 페이지 (`index.md` + `data.json`) |
| `layouts/practice/single.html` | 실습 페이지 템플릿 — `data.json`을 삽입하고 JS 번들을 로드 |
| `assets/js/practice/` | 4단계 실습 UI (바닐라 JS, Hugo 내장 esbuild로 번들) |
| `.github/workflows/daily.yml` | push 후킹 + 테스트 + 생성/배포 워크플로 (크론 없음 — 후킹 전용) |
| `themes/PaperMod` | Hugo 테마 (git submodule) |
| `assets/css/extended/` | 카드 그리드·실습 페이지 스타일 (PaperMod 오버라이드 훅) |
| `static/CNAME` | 커스텀 도메인 설정 |

## 로컬에서 테스트

```bash
hugo server -D                                    # http://localhost:1313/
python3 -m unittest discover pipeline -p "test_*.py" -v
node --test assets/js/practice/*.test.mjs
python3 pipeline/generate.py --dry-run             # 파일 생성 없이 결과만 확인
```

로컬에는 `claude` CLI 로그인 세션이 있으면 그대로 사용되고(`JUDGE_BACKEND=claude-code`),
없으면 `ANTHROPIC_API_KEY`를 설정해 `JUDGE_BACKEND=api`로 실행할 수 있다.
````

- [ ] **Step 2: Replace `input/script.md`'s instructions and empty block**

````markdown
<!--
  유튜브 영상 구간을 붙여넣으면 직독직해·낭독·듣기·정리 4단계 실습 페이지가 만들어집니다.
  - 이 파일을 GitHub에서 바로 편집하세요 (저장소 페이지 → 이 파일 → 연필 ✏️ 아이콘 →
    edit → Commit changes). 로컬 git 작업이 필요 없습니다. 블로그 상단
    "Add Transcript ✏️" 버튼이 바로 이 페이지로 연결됩니다.
  - 코드블록 첫 줄에 유튜브 URL, 그다음 줄부터 유튜브 "스크립트 표시" 패널에서
    복사한 구간을 타임스탬프 포함해서 그대로 붙여넣으세요. 구간은 20~60초가
    적당하고 180초를 넘으면 처리되지 않습니다.
  - 구간 여러 개를 한꺼번에 넣으려면 `---` 만 있는 줄로 구분하세요 — 구간마다
    페이지가 하나씩 생성됩니다.
  - 저장(커밋)하는 순간 파이프라인이 바로 실행됩니다(push 후킹). 이미 게시된
    구간(영상+시작+끝 기준)은 다시 나타나도 건너뛰므로 예전 내용을 지울 필요는
    없습니다.
  - 이 파이프라인은 후킹 전용입니다 — 입력이 비어 있으면 그날은 아무것도
    게시되지 않습니다 (매일 자동 게시되는 폴백 없음).
  - 개인정보: 영상에 개인을 특정할 수 있는 내용이 보이면 붙여넣기 전에 지우는
    것을 권장합니다. 이 저장소는 public이라 붙여넣은 원문이 커밋되는 순간
    공개됩니다.

  예시:
  https://youtu.be/VIDEO_ID
  4:12
  Most people think happiness comes from big
  4:15
  moments, a promotion, a vacation or a perfect day.
-->
```
```
````

- [ ] **Step 3: Commit**

```bash
git add README.md input/script.md
git commit -m "docs: rewrite README and input instructions for the practice pipeline"
```

## Task 15: End-to-end verification with real data

**Files:** none created — this task runs the full pipeline and site against the video already analyzed for the spec (the "happiness" segment, `7KMo8GOwg78`, roughly 4:12–4:31) and manually walks through the 4 stages in a browser.

**Interfaces:** none — this is the integration check tying every prior task together.

- [ ] **Step 1: Run the full test suite once, from a clean checkout state**

```bash
cd pipeline && python3 -m unittest discover -p "test_*.py" -v && cd ..
cd assets/js/practice && node --test && cd ../../..
```

Expected: every test from Tasks 1, 2, 4, 5, 6, 9 passes.

- [ ] **Step 2: Paste real input and dry-run**

Put this in `input/script.md`'s code block (the same segment used while writing the spec):

```
https://youtu.be/7KMo8GOwg78
4:12
Most people think happiness comes from big
4:15
moments, a promotion, a vacation or a perfect day.
4:19
But research shows that's not how it works.
4:22
It's not about how intense the experience is.
4:25
It's about how often you feel good.
4:28
Simply put, it's frequency that matters, not intensity.
```

Run: `python3 pipeline/generate.py --dry-run`

Check the printed JSON: `sentences` reconstructs the fragments into natural sentences, `chunks[].ko` reads as left-to-right literal Korean (not reordered translation), `words` marks 2-5 strong words per sentence with plausible `syl`, `questions` has 3-5 items whose `answer` index is correct, `vocab` picks up phrases like "simply put" or "frequency". If anything is off (e.g. chunks don't cover the full sentence, syl spellings don't appear in their word), that is a prompt-wording issue in Task 2's `GENERATE_PROMPT` — fix the wording and re-run before moving on, since this is the actual content quality bar, not just schema validity.

- [ ] **Step 3: Generate for real and build**

```bash
python3 pipeline/generate.py
hugo --minify
```

Expected: a new directory under `content/practice/`, `hugo --minify` builds with 0 errors, and the terminal log shows a match ratio ≥ 0.6 (if it's lower, inspect whether Claude paraphrased too far from the original fragment wording — tighten "fillers/false starts... cleaned up" in the prompt if so).

- [ ] **Step 4: Serve locally and walk through all 4 stages**

```bash
hugo server -D
```

Open the generated practice page and manually verify, checking off each:
- [ ] Stage 1: countdown matches the segment length; script shows chunk breaks (`/`); timing out (or clicking "다 읽었다") blurs the script and reveals per-sentence 이해됨/막힘 buttons; "뜻 보기" unblurs and shows Korean chunk meanings; result shows understood count and elapsed time.
- [ ] Stage 2: stressed words are bold with underlined syllable, weak words are faded, linked words show `‿`; clicking 녹음 시작 asks for mic permission; after 끝, shows elapsed vs. target and (if Chrome/Edge) a recognition percentage; recorded audio is playable.
- [ ] Stage 3: the player area is covered by the "듣기에 집중하세요" overlay; 전체 듣기 plays only the segment and stops at the end; after the first full listen, comprehension questions appear; 채점 shows ✅/❌ with the `why` text; dictation inputs appear per sentence, 확인 shows match/wrong/missing/extra coloring and then reveals that sentence's stress markup with a 다시 듣기 button.
- [ ] Stage 4: full script with stress markup and chunk translations, vocab list, a result summary grid reflecting what was actually done in stages 1-3, and (on a second run) a "직전 시도" line.
- [ ] Resize to a narrow (mobile) width and confirm the tabs and stage content remain usable (no horizontal overflow).

**Mic and speech-recognition specifically:** if this session's own browser tooling cannot grant microphone access or exercise `SpeechRecognition`, say so explicitly here rather than claiming it was verified, and ask the user to click through Stage 2's recording once themselves in a real Chrome/Edge window — per spec §8's instruction that this gap must be reported, not silently assumed to work.

- [ ] **Step 5: Clean up the test content before shipping**

Decide with the user whether to keep this real generated page as the site's first practice page or remove it (`rm -rf content/practice/<generated-dir>`, restore `pipeline/state.json` to `{"processed": {}}`, restore `input/script.md`'s empty code block) before the branch is considered done — don't leave throwaway verification content in `main` silently.

- [ ] **Step 6: Commit (only the state.json/input reset, if the content was removed in Step 5)**

```bash
git add pipeline/state.json input/script.md
git commit -m "chore: reset pipeline state after end-to-end verification"
```

(Skip this commit if the generated page was kept instead — then `git add content/practice pipeline/state.json input/script.md` and commit as a real first page, e.g. `"content: add first practice page (happiness segment)"`.)

---
