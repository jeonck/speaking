#!/usr/bin/env python3
"""Transcript study pipeline — 유튜브 구간 → 4단계 실습 페이지.

input/script.md 코드블록에 유튜브 URL + 스크립트 패널 복붙을 넣으면, 그 구간으로
직독직해 → 스피킹 → 가리고 듣기 → 정리 4단계 실습 페이지(content/practice/<slug>/)를
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
        for c in chunks:
            if not isinstance(c, dict):
                return None
            if not isinstance(c.get("en"), str):
                return None
            if not isinstance(c.get("ko"), str) or not c["ko"].strip():
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
        if not isinstance(q.get("q"), str) or not q["q"].strip():
            return None
        options = q.get("options")
        if not isinstance(options, list) or not (3 <= len(options) <= 4):
            return None
        if not all(isinstance(o, str) for o in options):
            return None
        answer = q.get("answer")
        if not isinstance(answer, int) or isinstance(answer, bool) or not (0 <= answer < len(options)):
            return None
        q["why"] = str(q.get("why") or "").strip()

    vocab = data.get("vocab") or []
    if not isinstance(vocab, list):
        vocab = []
    # 개별 vocab 항목이 term/ko를 갖추지 못하면 그 항목만 버린다 (words 정제와 같은 패턴) —
    # 전체 결과를 무효화할 정도의 문제는 아니다.
    data["vocab"] = [
        v
        for v in vocab
        if isinstance(v, dict)
        and isinstance(v.get("term"), str)
        and v["term"].strip()
        and isinstance(v.get("ko"), str)
        and v["ko"].strip()
    ]

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
title: {yaml_quote(result['title'])}
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
    # <script type="application/json"> 안에 그대로 삽입되므로 "<"를 전부 이스케이프한다.
    # HTML 종료 태그 매칭은 대소문자를 가리지 않으므로 "</script" 리터럴만 바꿔서는
    # </SCRIPT나 </ScRiPt를 놓친다 — JSON 문자열 값 안에서 유효한 <로 치환한다.
    data_json = data_json.replace("<", "\\u003c")
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
