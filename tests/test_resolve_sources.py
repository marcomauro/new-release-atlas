"""
Test del risolutore YouTube (scripts/resolve_sources.py) e della sua fusione
nel grafo (scripts/build_graph.py). Nessuna rete: la YouTube Data API è
sostituita da un fetch finto che restituisce risposte preconfezionate.

Esecuzione:  python3 -m unittest discover -s tests -v
"""

import json
import os
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "scripts"))

import build_graph  # noqa: E402
import resolve_sources as rs  # noqa: E402

TRACK = {"id": "SP1", "title": 'Winter in America - 12" Version',
         "primary_artist": "Brian Jackson", "duration_sec": 538}


def video(vid, title, channel, dur, desc="", embeddable=True, blocked=None):
    item = {"id": vid,
            "snippet": {"title": title, "channelTitle": channel, "description": desc},
            "contentDetails": {"duration": dur},
            "status": {"embeddable": embeddable, "privacyStatus": "public"}}
    if blocked:
        item["contentDetails"]["regionRestriction"] = {"blocked": blocked}
    return item


def fake_fetch(items, calls=None):
    """search -> gli id di items; videos -> items (dettagli)."""
    def fetch(url):
        if calls is not None:
            calls.append(url)
        if "/search?" in url:
            return {"items": [{"id": {"videoId": it["id"]}} for it in items]}
        return {"items": items}
    return fetch


class ParsingTest(unittest.TestCase):
    def test_iso_duration(self):
        self.assertEqual(rs.iso_duration("PT8M58S"), 538)
        self.assertEqual(rs.iso_duration("PT1H2M3S"), 3723)
        self.assertEqual(rs.iso_duration("PT45S"), 45)
        self.assertIsNone(rs.iso_duration(""))
        self.assertIsNone(rs.iso_duration("P"))

    def test_normalization_is_comparison_only(self):
        # accenti e segni combinanti spariscono SOLO nel confronto
        self.assertEqual(rs.tokens("Café Ünïcode (feat. X)"), {"cafe", "unicode", "feat", "x"})
        t = dict(TRACK, title="Ţ̷̛̼ḯ̸̖t̶̰̔l̷̗̓ë̵͓")
        before = json.dumps(t, ensure_ascii=False)
        rs.score(t, {"title": "Title", "channel": "", "duration_sec": 538})
        self.assertEqual(json.dumps(t, ensure_ascii=False), before)


class ScoreTest(unittest.TestCase):
    def test_topic_upload_with_exact_duration_matches(self):
        v = {"title": 'Winter in America (12" Version)', "channel": "Brian Jackson - Topic",
             "description": "Provided to YouTube by Strut", "duration_sec": 538}
        self.assertGreaterEqual(rs.score(TRACK, v), rs.MATCH_MIN)

    def test_wrong_version_scores_below_right_one(self):
        right = {"title": 'Brian Jackson - Winter in America (12" Version)', "channel": "Strut",
                 "duration_sec": 539}
        radio = {"title": "Brian Jackson - Winter in America", "channel": "Strut",
                 "duration_sec": 241}
        self.assertGreater(rs.score(TRACK, right), rs.score(TRACK, radio))

    def test_cover_and_karaoke_are_rejected(self):
        cover = {"title": "Winter in America 12 Version - piano cover", "channel": "Someone",
                 "duration_sec": 538}
        self.assertLess(rs.score(TRACK, cover), rs.REVIEW_MIN)

    def test_artist_word_is_not_a_cover_signal(self):
        t = {"title": "Night Shift", "primary_artist": "Drum Talk", "duration_sec": 300}
        v = {"title": "Drum Talk - Night Shift", "channel": "Drum Talk - Topic", "duration_sec": 300}
        self.assertGreaterEqual(rs.score(t, v), rs.MATCH_MIN)


class ResolveTest(unittest.TestCase):
    def test_best_candidate_wins_and_non_embeddable_is_dropped(self):
        items = [
            video("BLOCKED", 'Winter in America (12" Version)', "Brian Jackson - Topic", "PT8M58S",
                  "Provided to YouTube by Strut", embeddable=False),
            video("GOOD", 'Winter in America (12" Version)', "Brian Jackson - Topic", "PT8M58S",
                  "Provided to YouTube by Strut"),
            video("LIVE", "Brian Jackson - Winter in America (Live)", "fan", "PT6M00S"),
        ]
        e = rs.resolve_one(TRACK, "KEY", fetch=fake_fetch(items), today="2026-10-17")
        self.assertEqual((e["status"], e["id"]), ("matched", "GOOD"))
        self.assertEqual(e["checked"], "2026-10-17")

    def test_region_blocked_video_is_dropped(self):
        items = [video("V1", 'Winter in America (12" Version)', "Brian Jackson - Topic", "PT8M58S",
                       "Provided to YouTube by Strut", blocked=["IT"])]
        e = rs.resolve_one(TRACK, "KEY", region="IT", fetch=fake_fetch(items))
        self.assertEqual(e["status"], "none")

    def test_no_results_is_none_and_skips_videos_call(self):
        calls = []
        e = rs.resolve_one(TRACK, "KEY", fetch=fake_fetch([], calls))
        self.assertEqual(e["status"], "none")
        self.assertEqual(len(calls), 1)

    def test_uncertain_match_goes_to_review_with_alternatives(self):
        items = [video("MAYBE", "Brian Jackson Winter in America", "Uploader", "PT8M50S"),
                 video("ALT", "Winter in America", "Other", "PT4M00S")]
        e = rs.resolve_one(TRACK, "KEY", fetch=fake_fetch(items))
        self.assertEqual(e["status"], "review")
        self.assertEqual(e["id"], "MAYBE")
        self.assertTrue(all(len(a) == 2 for a in e["alt"]))

    def test_todo_skips_cached_and_overridden(self):
        tracks = [{"id": i} for i in ("A", "B", "C", "D")]
        cache = {"A": {"status": "matched"}, "B": {"status": "none"}}
        overrides = {"C": None}
        self.assertEqual([t["id"] for t in rs.todo(tracks, cache, overrides)], ["D"])
        self.assertEqual([t["id"] for t in rs.todo(tracks, cache, overrides, retry_none=True)], ["B", "D"])
        self.assertEqual([t["id"] for t in rs.todo(tracks, cache, overrides, refresh=True)], ["A", "B", "D"])


class BuildMergeTest(unittest.TestCase):
    def test_only_matched_and_overrides_reach_the_graph(self):
        with tempfile.TemporaryDirectory() as d:
            src, ovr = os.path.join(d, "s.json"), os.path.join(d, "o.json")
            with open(src, "w") as f:
                json.dump({"youtube": {
                    "A": {"status": "matched", "id": "ytA"},
                    "B": {"status": "review", "id": "ytB"},
                    "C": {"status": "matched", "id": "ytC"},
                    "D": {"status": "none"},
                }}, f)
            with open(ovr, "w") as f:
                json.dump({"youtube": {"C": None, "D": "ytD"}}, f)
            self.assertEqual(build_graph.load_sources(src, ovr)["youtube"], {"A": "ytA", "D": "ytD"})

    def test_missing_files_mean_no_sources(self):
        self.assertEqual(build_graph.load_sources("/nope.json", "/nope2.json"), {"youtube": {}})

    def test_build_emits_yt_only_where_known(self):
        def occ(tid, title, artist):
            return {"spotify_track_id": tid, "title": title, "artists": [artist],
                    "primary_artist": artist, "spotify_url": "u", "duration": "3:00",
                    "duration_sec": 180, "genres": ["jazz"], "genre_primary": "jazz",
                    "playlist_number": 1}
        archive = {"metadata": {}, "playlists": [],
                   "tracks_flat": [occ("A", "One", "X"), occ("B", "Two", "Y"), occ("C", "Three", "X")]}
        g = build_graph.build(archive, sources={"youtube": {"A": "ytA"}})
        by = {n["id"]: n for n in g["nodes"]}
        self.assertEqual(by["A"]["yt"], "ytA")
        self.assertNotIn("yt", by["B"])
        self.assertEqual(g["meta"]["sources"], {"youtube": 1})
        self.assertEqual(build_graph.build(archive)["meta"]["sources"], {"youtube": 0})


if __name__ == "__main__":
    unittest.main()
