"""
UTF-8 / pathological-Unicode safety of the archive and the generated graph.

Playlist #39 track 3 (id 68ozhSrI4eLbnUgih1SlOT, Four Tet published under a
Zalgo pseudonym) is the canary: 255 code points, 501 UTF-8 bytes, hundreds of
combining marks, already NFC. If a future refactor normalizes, truncates or
regex-cleans titles anywhere in the pipeline, these tests fail.

Run:  python3 -m unittest discover -s tests
"""

import json
import os
import unicodedata
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVE = os.path.join(REPO, "data", "spotify_archive_enriched.json")
GRAPH = os.path.join(REPO, "public", "graph.json")

CANARY_ID = "68ozhSrI4eLbnUgih1SlOT"
CANARY_CODE_POINTS = 255
CANARY_UTF8_BYTES = 501
CANARY_REAL_ARTIST = "Four Tet"


def load(path):
    # explicit encoding: on Windows the default (cp1252) would raise
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class UnicodeSafetyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.archive = load(ARCHIVE)
        cls.graph = load(GRAPH)

    def canary_occurrences(self):
        return [t for t in self.archive["tracks_flat"]
                if t["spotify_track_id"] == CANARY_ID]

    def test_archive_title_intact(self):
        """No normalization and no truncation survived the merge."""
        occ = self.canary_occurrences()
        self.assertTrue(occ, "canary track missing from the archive")
        for t in occ:
            self.assertEqual(len(t["title"]), CANARY_CODE_POINTS)
            self.assertEqual(len(t["title"].encode("utf-8")), CANARY_UTF8_BYTES)
            # NFC must be a no-op: the string is already normalized, and NFKC/NFKD
            # would rewrite the compatibility symbols (i.e. destroy it).
            self.assertEqual(unicodedata.normalize("NFC", t["title"]), t["title"])

    def test_raw_artist_preserved_and_real_name_present(self):
        """artists[0] stays the raw Spotify value (needed for API matching);
        the human-readable name is an ADDED entry, not a replacement."""
        for t in self.canary_occurrences():
            self.assertIn(CANARY_REAL_ARTIST, t["artists"])
            self.assertNotEqual(t["artists"][0], CANARY_REAL_ARTIST)
            self.assertGreater(sum(1 for c in t["artists"][0]
                                   if unicodedata.category(c) == "Mn"), 0)

    def test_graph_node_intact(self):
        """build_graph.py copies the title through untouched."""
        node = next((n for n in self.graph["nodes"] if n["id"] == CANARY_ID), None)
        self.assertIsNotNone(node, "canary track missing from the graph")
        self.assertEqual(len(node["title"]), CANARY_CODE_POINTS)
        self.assertEqual(len(node["title"].encode("utf-8")), CANARY_UTF8_BYTES)
        self.assertIn(CANARY_REAL_ARTIST, node["artists"])

    def test_graph_links_via_real_artist_name(self):
        """Artist edges use every entry of artists[], so the track is wired to
        the rest of the Four Tet catalogue despite the Zalgo primary name."""
        nodes = self.graph["nodes"]
        by_id = {n["id"]: i for i, n in enumerate(nodes)}
        four_tet = {i for i, n in enumerate(nodes)
                    if CANARY_REAL_ARTIST in n.get("artists", [])}
        if len(four_tet) < 2:
            self.skipTest("only one Four Tet track in the archive")
        ci = by_id[CANARY_ID]
        linked = any(
            l["c"][0] > 0 and {l["source"], l["target"]} <= four_tet
            and ci in (l["source"], l["target"])
            for l in self.graph["links"]
        )
        self.assertTrue(linked, "canary not linked to the other Four Tet tracks")

    def test_every_title_round_trips_as_ascii_escaped_json(self):
        """ensure_ascii=True must round-trip identically for every title: that's
        the safe wire format for any downstream system with a dubious charset."""
        titles = [t["title"] for t in self.archive["tracks_flat"]]
        self.assertEqual(json.loads(json.dumps(titles, ensure_ascii=True)), titles)


if __name__ == "__main__":
    unittest.main()
