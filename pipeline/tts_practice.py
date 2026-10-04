#!/usr/bin/env python3
"""영상 없이 문장만 있는 실습 — macOS 원어민 음성(say)으로 음성 파일을 만들어 실습 페이지 번들을 쓴다.

content/practice/<slug>/{index.md, data.json, audio.m4a}. 실습 페이지는 data.json의
"audio"가 있으면 YouTube 대신 이 파일을 재생한다(assets/js/practice/player.js).

Usage:
    python pipeline/tts_practice.py CONTENT.json [--voice "Ava (Premium)"] [--rate 175] [--pause 0.8]

CONTENT.json은 generate.py가 Claude에게 받는 결과와 같은 모양이다:
    {"title", "summary", "tags", "sentences": [{"text", "chunks", "words", "tip", "voice"?}], "questions", "vocab"}
문장별 start/end는 이 스크립트가 실제 음성 길이로 계산해 채운다. 문장에 "voice"가 있으면 그 문장만
그 목소리로 — 면접 질문(면접관)과 답(지원자)처럼 화자가 둘인 실습에 쓴다.
"""

import argparse
import json
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from generate import CONTENT_DIR, KST, parse_result, slugify, yaml_quote

SAMPLE_RATE = 44100


def duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def synthesize(sentences: list[tuple[str, str]], rate: int, pause: float, out: Path) -> list[dict]:
    """(문장, 목소리)마다 음성을 만들고 사이에 pause초 쉼을 넣어 한 파일로 잇는다. 문장별 {start, end}를 돌려준다."""
    timings, parts = [], []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        silence = tmp / "pause.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono",
                        "-t", str(pause), str(silence)], check=True)
        t = 0.0
        for i, (text, voice) in enumerate(sentences):
            aiff, wav = tmp / f"{i}.aiff", tmp / f"{i}.wav"
            subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", str(aiff), text], check=True)
            subprocess.run(["ffmpeg", "-v", "error", "-i", str(aiff), "-ar", str(SAMPLE_RATE), "-ac", "1", str(wav)], check=True)
            d = duration(wav)
            timings.append({"start": round(t, 2), "end": round(t + d, 2)})
            parts += [wav, silence]
            t += d + pause
        listing = tmp / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts[:-1]))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                        "-c:a", "aac", "-b:a", "96k", str(out)], check=True)
    return timings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("content")
    ap.add_argument("--voice", default="Samantha")
    ap.add_argument("--rate", type=int, default=175, help="말 빠르기(분당 단어 수)")
    ap.add_argument("--pause", type=float, default=0.8, help="문장 사이 쉼(초)")
    args = ap.parse_args()

    result = parse_result(Path(args.content).read_text(encoding="utf-8"))
    if result is None:
        raise SystemExit("content JSON 형식이 맞지 않습니다 (generate.parse_result 검증 실패)")

    now = datetime.now(KST)
    dir_path = CONTENT_DIR / f"{now.date().isoformat()}-{slugify(result['title'])}"
    dir_path.mkdir(parents=True, exist_ok=False)
    lines = [(s["text"], s.get("voice") or args.voice) for s in result["sentences"]]
    timings = synthesize(lines, args.rate, args.pause, dir_path / "audio.m4a")
    for s, t in zip(result["sentences"], timings):
        s.update(t)
    total = timings[-1]["end"]

    tags = ", ".join(yaml_quote(t) for t in result["tags"])
    (dir_path / "index.md").write_text(f"""---
title: {yaml_quote(result['title'])}
date: {now.isoformat()}
summary: {yaml_quote(result['summary'])}
tags: [{tags}]
duration: {round(total)}
---
""", encoding="utf-8")
    data = {
        "audio": "audio.m4a",
        "voice": ", ".join(dict.fromkeys(v for _, v in lines)),
        "segment": {"start": 0, "end": total},
        "sentences": result["sentences"],
        "questions": result["questions"],
        "vocab": result["vocab"],
    }
    (dir_path / "data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1).replace("<", "\\u003c"), encoding="utf-8")
    print(dir_path, f"{total:.1f}s", args.voice)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
