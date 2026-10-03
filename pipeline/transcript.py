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
    prev_start = float("-inf")
    for i, (start_idx, end_idx) in enumerate(sent_bounds):
        found = None
        for idx in range(start_idx, end_idx):
            if idx in sent_to_frag:
                frag_idx = sent_to_frag[idx]
                if 0 <= frag_idx < len(frag_words):
                    # 문장 자신의 첫 단어가 아니라 idx번째(start_idx보다 뒤) 단어에서
                    # 매칭이 됐다면, 그 사이 단어 수 × 0.3초만큼을 빼서 문장의 실제
                    # 시작 시각을 추정한다 (spec §4-4).
                    found = frag_words[frag_idx][1] - (idx - start_idx) * 0.3
                break
        fallback_base = prev_start if i > 0 else segment_start
        if found is None or found <= prev_start:
            found = fallback_base + 0.1
        timings.append({"start": found})
        prev_start = found

    for i in range(len(timings) - 1):
        timings[i]["end"] = timings[i + 1]["start"]
    if timings:
        timings[-1]["end"] = segment_end

    return timings, ratio
