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
        self.assertAlmostEqual(end, 10.0 + max(1.5, 3 * 0.4))

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

    def test_offset_subtracted_when_match_is_not_sentences_first_word(self):
        # 문장의 첫 단어("zzz")는 자막에 없고, 두 번째/세 번째 단어("hello","there")만
        # 있다. frag_words는 균등 분배되어 hello=10/3초, there=20/3초가 된다.
        # idx(=1)가 start_idx(=0)보다 1 뒤이므로 0.3초를 빼야 한다 — 보정 없으면
        # 10/3초(약 3.33)가 되고, 보정하면 10/3 - 0.3(약 3.03)이 된다.
        fragments = [{"start": 0.0, "text": "xxx hello there"}]
        sentences = ["Zzz hello there."]
        timings, _ = align_sentences(sentences, fragments, segment_end=10.0)
        expected = 10 / 3 - 0.3
        self.assertAlmostEqual(timings[0]["start"], expected, places=6)
        self.assertLess(timings[0]["start"], 10 / 3)


class NormalizeWordTest(unittest.TestCase):
    def test_strips_punctuation_and_case(self):
        self.assertEqual(normalize_word("Happiness,"), "happiness")
        self.assertEqual(normalize_word("Don’t"), "don't")
        self.assertEqual(normalize_word("“Quoted”"), "quoted")


if __name__ == "__main__":
    unittest.main()
