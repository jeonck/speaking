"""실습 난이도(레벨) — 원고와 실제 음성 길이로 계산한다.

세 가지를 본다. 듣기 어려움에 가장 큰 말 빠르기에 무게를 둔다.
  - 말 빠르기: 초당 단어 수(문장별 실제 음성 길이 기준)
  - 문장 길이: 문장당 단어 수
  - 긴 단어 비율: 3음절 이상 단어의 비율(어휘 난도의 대용)
각각을 2026-10 기준 실습 226개의 중앙값으로 나눠 더한 점수를, 같은 실습들의 3분위(0.974, 1.121)로
입문(1)·중급(2)·고급(3)으로 나눈다. 새 실습도 같은 기준으로 매긴다 — 기준이 실습이 늘 때마다 흔들리지 않게.

Usage (기존 실습 전체에 레벨 쓰기): python pipeline/level.py
"""

import json
import re
from pathlib import Path

MEDIAN_WPS, MEDIAN_WORDS_PER_SENTENCE, MEDIAN_LONG_RATIO = 2.6, 18.2, 0.13
CUTS = (0.974, 1.121)
NAMES = {1: "입문", 2: "중급", 3: "고급"}


def syllables(word: str) -> int:
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    n = len(re.findall(r"[aeiouy]+", w))
    if w.endswith("e") and not w.endswith(("le", "ee")) and n > 1:
        n -= 1
    return max(1, n)


def features(sentences: list[dict]) -> dict:
    words = [w for s in sentences for w in s["text"].split()]
    speech = sum(max(0.1, s["end"] - s["start"]) for s in sentences)
    return {
        "wps": len(words) / speech,
        "words_per_sentence": len(words) / len(sentences),
        "long_ratio": sum(1 for w in words if syllables(w) >= 3) / len(words),
    }


def score(sentences: list[dict]) -> float:
    f = features(sentences)
    return (0.5 * f["wps"] / MEDIAN_WPS
            + 0.25 * f["words_per_sentence"] / MEDIAN_WORDS_PER_SENTENCE
            + 0.25 * f["long_ratio"] / MEDIAN_LONG_RATIO)


def level_of(sentences: list[dict]) -> int:
    s = score(sentences)
    return 1 if s < CUTS[0] else 2 if s < CUTS[1] else 3


def set_front_matter_level(index_md: Path, level: int) -> None:
    """index.md 앞부분에 level: N을 쓴다(있으면 바꾼다)."""
    text = index_md.read_text(encoding="utf-8")
    head, sep, body = text.partition("\n---\n")
    lines = [l for l in head.split("\n") if not l.startswith("level:")]
    index_md.write_text("\n".join(lines) + f"\nlevel: {level}" + sep + body, encoding="utf-8")


def main() -> int:
    root = Path(__file__).resolve().parent.parent / "content" / "practice"
    counts = {1: 0, 2: 0, 3: 0}
    for data_file in sorted(root.glob("*/data.json")):
        level = level_of(json.loads(data_file.read_text(encoding="utf-8"))["sentences"])
        set_front_matter_level(data_file.parent / "index.md", level)
        counts[level] += 1
    print({NAMES[k]: v for k, v in counts.items()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
