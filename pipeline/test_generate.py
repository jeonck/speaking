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

    def test_chunk_missing_ko_rejected(self):
        bad = json.loads(json.dumps(VALID_RESULT))
        del bad["sentences"][0]["chunks"][0]["ko"]
        self.assertIsNone(generate.parse_result(json.dumps(bad)))

    def test_question_option_not_string_rejected(self):
        bad = json.loads(json.dumps(VALID_RESULT))
        bad["questions"][0]["options"][0] = 123
        self.assertIsNone(generate.parse_result(json.dumps(bad)))

    def test_vocab_entry_missing_term_is_dropped(self):
        good = json.loads(json.dumps(VALID_RESULT))
        good["vocab"].append({"ko": "뜻만 있고 term 없음"})
        result = generate.parse_result(json.dumps(good))
        self.assertEqual(len(result["vocab"]), 1)


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
        path = generate.write_practice_bundle(
            self.item, self.result, "Original Title", self.now, "NOAA Channel"
        )
        self.created.append(path.parent)
        self.assertTrue(path.exists())
        data = json.loads((path.parent / "data.json").read_text())
        self.assertEqual(data["video_id"], "7KMo8GOwg78")
        self.assertEqual(data["source_title"], "Original Title")
        self.assertEqual(data["source_channel"], "NOAA Channel")
        self.assertEqual(data["sentences"][0]["start"], 0.0)

    def test_script_close_tag_in_data_is_escaped(self):
        self.result["summary"] = "a </script> tag and a </ScRiPt> tag"
        path = generate.write_practice_bundle(self.item, self.result, None, self.now)
        self.created.append(path.parent)
        raw = (path.parent / "data.json").read_text()
        self.assertNotIn("</script>", raw)
        self.assertNotIn("</ScRiPt>", raw)
        self.assertNotIn("<", raw)


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
