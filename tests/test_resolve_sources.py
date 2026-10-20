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
import urllib.error
import urllib.parse
from io import BytesIO
from unittest import mock

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


def fake_fetch(items, calls=None, search=None, channels=(), uploads=None):
    """Finta YouTube Data API.

    items: i video noti (dettagli per videos.list); search: gli id restituiti
    dalla ricerca video (default: tutti); channels: [(channelId, nome)] per la
    ricerca canali; uploads: {playlistId: [pagina, ...]}, pagina = [(videoId, titolo)].
    """
    def fetch(url):
        if calls is not None:
            calls.append(url)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).items()}
        if "/search?" in url and q.get("type") == "channel":
            return {"items": [{"id": {"channelId": c}, "snippet": {"channelTitle": n}} for c, n in channels]}
        if "/search?" in url:
            ids = search if search is not None else [it["id"] for it in items]
            return {"items": [{"id": {"videoId": i}} for i in ids]}
        if "/playlistItems?" in url:
            pages = (uploads or {}).get(q["playlistId"])
            if pages is None:
                raise RuntimeError("HTTP 404 playlistNotFound")
            n = int(q.get("pageToken", 0))
            out = {"items": [{"snippet": {"title": t, "resourceId": {"videoId": v}}} for v, t in pages[n]]}
            if n + 1 < len(pages):
                out["nextPageToken"] = str(n + 1)
            return out
        wanted = q["id"].split(",")
        return {"items": [it for it in items if it["id"] in wanted]}
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

    # casi presi dal primo giro reale (2026-10-19)
    def test_teaser_with_right_title_is_not_even_review(self):
        t = {"title": "OYSTRI (feat. Richard Spaven)", "primary_artist": "Petter Eldh", "duration_sec": 186}
        v = {"title": "Petter Eldh - OYSTRI feat. Richard Spaven | Projekt Drums Vol. 2",
             "channel": "Edition Records", "duration_sec": 38}
        self.assertLess(rs.score(t, v), rs.REVIEW_MIN)

    def test_live_take_far_off_in_duration_is_not_even_review(self):
        t = {"title": "Paris", "primary_artist": "CORBAAL", "duration_sec": 297}
        v = {"title": '"PARIS" live - CORBAAL x TRUFFAZ', "channel": "Production Production",
             "duration_sec": 213}
        self.assertLess(rs.score(t, v), rs.REVIEW_MIN)

    def test_artist_channel_beats_lyrics_reupload(self):
        t = {"title": "Time Will Tell", "primary_artist": "Celeste", "duration_sec": 224}
        reupload = {"title": "Celeste - Time Will Tell (Lyrics)", "channel": "Trending Now Lyrics",
                    "duration_sec": 226}
        official = {"title": "Celeste - Time Will Tell", "channel": "Celeste", "duration_sec": 226}
        self.assertGreater(rs.score(t, official), rs.score(t, reupload))
        vevo = {"title": "Tame Impala - Ethereal Connection", "channel": "tameimpalaVEVO"}
        self.assertEqual(rs.official_channel({"primary_artist": "Tame Impala"}, vevo), 1.0)

    def test_retuned_copy_loses_to_official_video(self):
        t = {"title": "Desire", "primary_artist": "Puma Blue", "duration_sec": 207}
        hz = {"title": "Puma Blue - Desire (432hz)", "channel": "DJ Raziel", "duration_sec": 209}
        official = {"title": "Puma Blue - Desire (Official Video)", "channel": "Puma Blue",
                    "duration_sec": 216}
        self.assertLess(rs.score(t, hz), rs.REVIEW_MIN)
        self.assertGreaterEqual(rs.score(t, official), rs.MATCH_MIN)


    def test_session_take_loses_to_studio_version(self):
        # stesso canale Topic, 2 s di scarto: "session" deve contare come versione
        t = {"title": "2close2farr", "primary_artist": "Momoko Gill", "duration_sec": 183}
        session = {"title": "2close2farr (BBC Maida Vale Session)", "channel": "Momoko Gill - Topic",
                   "duration_sec": 185}
        studio = {"title": "2close2farr", "channel": "Momoko Gill - Topic", "duration_sec": 183}
        self.assertGreater(rs.score(t, studio), rs.score(t, session))


class HttpTest(unittest.TestCase):
    def _http_error(self, code, reason):
        body = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
        return urllib.error.HTTPError("https://x", code, "err", {}, BytesIO(body))

    def test_429_and_quota_403_stop_the_run(self):
        for code, reason in ((429, "rateLimitExceeded"), (429, ""), (403, "quotaExceeded")):
            with mock.patch("urllib.request.urlopen", side_effect=self._http_error(code, reason)):
                with self.assertRaises(rs.QuotaExceeded):
                    rs.http_get_json("https://x")

    def test_other_errors_skip_the_track(self):
        with mock.patch("urllib.request.urlopen", side_effect=self._http_error(400, "badRequest")):
            with self.assertRaises(RuntimeError):
                rs.http_get_json("https://x")


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
        self.assertFalse([u for u in calls if "/videos?" in u])

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
        cache["A"] = {"status": "review"}
        self.assertEqual([t["id"] for t in rs.todo(tracks, cache, overrides, retry_review=True)], ["A", "D"])


class TopicFallbackTest(unittest.TestCase):
    # caso reale: la ricerca dà solo un teaser, l'Art Track sta nel canale Topic
    TRACK = {"id": "K1", "title": "Mind States", "primary_artist": "Koralle", "duration_sec": 174}
    ITEMS = [
        video("TEASER", "Koralle & Yawuh - Mind States (feat. Physical Graffiti)", "LE Groove", "PT26S"),
        video("ART", "Mind States", "Koralle - Topic", "PT2M54S", "Provided to YouTube by Melting Pot Music"),
        video("ECL", "Eclissi", "Koralle - Topic", "PT2M49S", "Provided to YouTube by Melting Pot Music"),
    ]
    CHANNELS = [("UCother", "Koralle - Topic"), ("UCkoralle", "Koralle - Topic"),
                ("UCdie", "Die Koralle")]
    UPLOADS = {"UUother": [[("X1", "Something Else")]],
               "UUkoralle": [[("ECL", "Eclissi"), ("Z", "Hot Summer")], [("ART", "Mind States")]]}

    def fetch(self, calls=None):
        return fake_fetch(self.ITEMS, calls, search=["TEASER"], channels=self.CHANNELS,
                          uploads=self.UPLOADS)

    def test_art_track_found_in_topic_channel_uploads(self):
        calls, cache = [], {}
        e = rs.resolve_one(self.TRACK, "KEY", fetch=self.fetch(calls), topic_cache=cache)
        self.assertEqual((e["status"], e["id"]), ("matched", "ART"))
        self.assertEqual(cache, {"Koralle": ["UCother", "UCkoralle"]})   # omonimi sì, "Die Koralle" no
        self.assertFalse([u for u in calls if "UUdie" in u])
        self.assertTrue([u for u in calls if "pageToken=1" in u])          # seconda pagina letta

    def test_channel_search_happens_once_per_artist(self):
        calls, cache = [], {}
        eclissi = {"id": "K2", "title": "Eclissi", "primary_artist": "Koralle", "duration_sec": 169}
        rs.resolve_one(self.TRACK, "KEY", fetch=self.fetch(calls), topic_cache=cache)
        e = rs.resolve_one(eclissi, "KEY", fetch=self.fetch(calls), topic_cache=cache)
        self.assertEqual((e["status"], e["id"]), ("matched", "ECL"))
        self.assertEqual(sum("type=channel" in u for u in calls), 1)

    def test_artist_without_topic_channel_is_cached_too(self):
        calls, cache = [], {}
        f = fake_fetch(self.ITEMS[:1], calls, channels=[("UCdie", "Die Koralle")])
        self.assertEqual(rs.resolve_one(self.TRACK, "KEY", fetch=f, topic_cache=cache)["status"], "none")
        self.assertEqual(cache, {"Koralle": []})

    def test_no_second_search_when_first_is_confident(self):
        calls = []
        items = [video("GOOD", 'Winter in America (12" Version)', "Brian Jackson - Topic", "PT8M58S",
                       "Provided to YouTube by Strut")]
        e = rs.resolve_one(TRACK, "KEY", fetch=fake_fetch(items, calls), topic_cache={})
        self.assertEqual(e["status"], "matched")
        self.assertEqual(len(calls), 2)                                     # search + videos

    def test_meter_counts_quota_units(self):
        meter = rs.Meter(self.fetch())
        rs.resolve_one(self.TRACK, "KEY", fetch=meter, topic_cache={})
        # 2 search (video, canali) + 1 videos + 1 + 2 pagine di caricamenti + 1 videos
        self.assertEqual(meter.units, 2 * 100 + 1 + 3 + 1)


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
