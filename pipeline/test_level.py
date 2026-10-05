import tempfile
import unittest
from pathlib import Path

import level


def sentences(text: str, seconds: float) -> list[dict]:
    return [{"text": text, "start": 0.0, "end": seconds}]


class LevelTest(unittest.TestCase):
    def test_syllables(self):
        self.assertEqual(level.syllables("cat"), 1)
        self.assertEqual(level.syllables("table"), 2)
        self.assertEqual(level.syllables("information"), 4)
        self.assertEqual(level.syllables("1913,"), 0)

    def test_slow_short_simple_is_beginner(self):
        s = sentences("The dog ran to the park and sat down.", 5.0)  # 9 words, 1.8 w/s
        self.assertEqual(level.level_of(s), 1)

    def test_fast_long_technical_is_advanced(self):
        text = ("Researchers investigated immunotherapy combinations targeting glioblastoma "
                "cells, demonstrating considerably improved survival across experimental populations today.")
        self.assertEqual(level.level_of(sentences(text, 4.0)), 3)

    def test_front_matter_level_is_written_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            md = Path(tmp) / "index.md"
            md.write_text('---\ntitle: "X"\nduration: 20\n---\n', encoding="utf-8")
            level.set_front_matter_level(md, 2)
            level.set_front_matter_level(md, 3)
            text = md.read_text(encoding="utf-8")
            self.assertEqual(text.count("level:"), 1)
            self.assertIn("level: 3\n---\n", text)


if __name__ == "__main__":
    unittest.main()
