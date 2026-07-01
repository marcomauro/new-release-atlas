"""
Test della pipeline dati (stdlib unittest, nessuna dipendenza).

Copre scripts/add_playlist.py (il merge automatizzato delle nuove playlist) e
scripts/check_archive.py (la guardia d'integrità che gira in CI), esercitandoli
come li usa l'utente: da linea di comando, su un mini-archivio sintetico.

Esecuzione:  python3 -m unittest discover -s tests -v
"""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADD = os.path.join(REPO, "scripts", "add_playlist.py")
CHECK = os.path.join(REPO, "scripts", "check_archive.py")

MOOD = {"energy": 0.5, "valence": 0.5, "danceability": 0.5,
        "acousticness": 0.5, "instrumentalness": 0.5}


def track(pl, pos, tid, title, artist, genre="jazz"):
    """Occorrenza completa in master-schema (arricchimento incluso)."""
    return {
        "playlist_number": pl, "playlist_name": f"New Release Friday #{pl}",
        "playlist_id": f"PLAYLIST{pl:02d}", "position_in_playlist": pos,
        "title": title, "artists": [artist], "primary_artist": artist,
        "duration": "3:30", "duration_sec": 210,
        "spotify_track_id": tid, "spotify_uri": f"spotify:track:{tid}",
        "spotify_url": f"https://open.spotify.com/track/{tid}",
        "genres": [genre], "genre_primary": genre,
        "subgenres": ["sub1"], "mood": ["warm"],
        "mood_parameters": dict(MOOD), "bpm": 100, "bpm_source": "estimated",
    }


def mini_archive():
    """Archivio sintetico coerente: 2 playlist, 3 occorrenze, 3 tracce uniche."""
    tracks = [
        track(1, 1, "AAAAAAAAAAAAAAAAAAAAAA", "Alpha", "Artist One", "jazz"),
        track(1, 2, "BBBBBBBBBBBBBBBBBBBBBB", "Beta", "Artist Two", "neo-soul"),
        track(2, 1, "CCCCCCCCCCCCCCCCCCCCCC", "Gamma", "Artist Three", "electronic"),
    ]
    def pl_entry(n):
        pls = [t for t in tracks if t["playlist_number"] == n]
        return {
            "playlist_number": n, "playlist_name": f"New Release Friday #{n}",
            "playlist_id": f"PLAYLIST{n:02d}",
            "spotify_url": f"https://open.spotify.com/playlist/PLAYLIST{n:02d}",
            "description": "", "date": None, "track_count": len(pls),
            "tracks": [{k: v for k, v in t.items()
                        if k not in ("playlist_number", "playlist_name", "playlist_id")}
                       for t in pls],
        }
    return {
        "metadata": {
            "playlist_range": "#1 - #2 (2 New Release Playlist consecutive)",
            "total_tracks_with_duplicates": 3, "unique_tracks": 3, "unique_artists": 3,
            "top_artists": [["Artist One", 1], ["Artist Two", 1], ["Artist Three", 1]],
        },
        "playlists": [pl_entry(1), pl_entry(2)],
        "tracks_flat": tracks,
    }


def support_pl3(tracks):
    return {"playlist_ids": {"3": "PLAYLIST03"}, "tracks": tracks}


CHAR_NEW = {
    "NNNNNNNNNNNNNNNNNNNNNN": {
        "G": ["jazz", "electronic"], "g": "Jazz", "sg": ["modal"],
        "m": ["deep"], "p": [0.4, 0.5, 0.6, 0.3, 0.7], "bpm": 120,
    }
}


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.archive = os.path.join(self.dir.name, "archive.json")
        self.data = mini_archive()
        self._write(self.archive, self.data)

    def tearDown(self):
        self.dir.cleanup()

    def _write(self, path, obj):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)

    def _read(self, path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    def run_add(self, support, char=None, extra=()):
        sp = os.path.join(self.dir.name, "support.json")
        self._write(sp, support)
        cmd = [sys.executable, ADD, "--support", sp, "--archive", self.archive]
        if char is not None:
            cp = os.path.join(self.dir.name, "char.json")
            self._write(cp, char)
            cmd += ["--char", cp]
        cmd += list(extra)
        return subprocess.run(cmd, capture_output=True, text=True, cwd=REPO)

    def run_check(self, path=None):
        return subprocess.run([sys.executable, CHECK, path or self.archive],
                              capture_output=True, text=True, cwd=REPO)

    # ---------- add_playlist: percorsi felici ----------

    def test_merge_new_and_reused(self):
        """Merge di 1 riusato + 1 nuovo: conteggi, riuso arricchimento, backup."""
        sup = support_pl3([
            {"pl": 3, "pos": 1, "id": "AAAAAAAAAAAAAAAAAAAAAA", "title": "Alpha",
             "artists": ["Artist One"], "dur": "3:30"},
            {"pl": 3, "pos": 2, "id": "NNNNNNNNNNNNNNNNNNNNNN", "title": "Nu",
             "artists": ["New Artist"], "dur": "4:00"},
        ])
        r = self.run_add(sup, CHAR_NEW)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        out = self._read(self.archive)
        self.assertEqual(len(out["playlists"]), 3)
        self.assertEqual(len(out["tracks_flat"]), 5)          # 3 + 2
        self.assertEqual(out["metadata"]["unique_tracks"], 4)  # 3 + 1 nuovo
        # il riusato eredita l'arricchimento originale, non ne serve uno nuovo
        reused = [t for t in out["tracks_flat"]
                  if t["spotify_track_id"] == "AAAAAAAAAAAAAAAAAAAAAA"
                  and t["playlist_number"] == 3][0]
        self.assertEqual(reused["genre_primary"], "jazz")
        self.assertEqual(reused["mood"], ["warm"])
        # duplicato cross-playlist annotato nei metadata
        dups = out["metadata"]["cross_playlist_duplicates"]
        self.assertIn([1, 3], [d["playlists"] for d in dups])
        # il nuovo brano porta la caratterizzazione data (macro prepesa ai sub)
        new = [t for t in out["tracks_flat"]
               if t["spotify_track_id"] == "NNNNNNNNNNNNNNNNNNNNNN"][0]
        self.assertEqual(new["subgenres"][0], "jazz")
        self.assertEqual(new["mood_parameters"]["energy"], 0.4)
        # backup scritto e identico al pre-merge
        self.assertEqual(self._read(self.archive + ".bak"), self.data)
        # l'archivio risultante passa la guardia d'integrità
        chk = self.run_check()
        self.assertEqual(chk.returncode, 0, chk.stdout)

    def test_preexisting_playlists_untouched(self):
        """Garanzia append-only: le playlist preesistenti restano identiche."""
        before = copy.deepcopy(self.data["playlists"])
        sup = support_pl3([{"pl": 3, "pos": 1, "id": "NNNNNNNNNNNNNNNNNNNNNN",
                            "title": "Nu", "artists": ["New Artist"], "dur": "4:00"}])
        r = self.run_add(sup, CHAR_NEW)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self._read(self.archive)["playlists"][:2], before)

    def test_dry_run_writes_nothing(self):
        sup = support_pl3([{"pl": 3, "pos": 1, "id": "NNNNNNNNNNNNNNNNNNNNNN",
                            "title": "Nu", "artists": ["New Artist"], "dur": "4:00"}])
        r = self.run_add(sup, CHAR_NEW, extra=("--dry-run",))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self._read(self.archive), self.data)
        self.assertFalse(os.path.exists(self.archive + ".bak"))

    # ---------- add_playlist: percorsi di errore ----------

    def test_missing_characterization_stops_with_todo(self):
        """Brano nuovo senza char -> exit 2 e id nel report (la to-do list)."""
        sup = support_pl3([{"pl": 3, "pos": 1, "id": "ZZZZZZZZZZZZZZZZZZZZZZ",
                            "title": "Mystery", "artists": ["Who"], "dur": "2:00"}])
        r = self.run_add(sup, {})
        self.assertEqual(r.returncode, 2)
        self.assertIn("ZZZZZZZZZZZZZZZZZZZZZZ", r.stdout)
        self.assertEqual(self._read(self.archive), self.data)  # niente scritture

    def test_duplicate_playlist_number_rejected(self):
        sup = {"playlist_ids": {"2": "PLAYLIST02"},
               "tracks": [{"pl": 2, "pos": 1, "id": "NNNNNNNNNNNNNNNNNNNNNN",
                           "title": "Nu", "artists": ["New Artist"], "dur": "4:00"}]}
        r = self.run_add(sup, CHAR_NEW)
        self.assertEqual(r.returncode, 1)
        self.assertIn("già presente", r.stderr)

    def test_invalid_char_rejected(self):
        bad = {"NNNNNNNNNNNNNNNNNNNNNN": {"G": ["jazz"], "sg": ["x"], "m": ["y"],
                                          "p": [0.5, 0.5]}}  # p troncato
        sup = support_pl3([{"pl": 3, "pos": 1, "id": "NNNNNNNNNNNNNNNNNNNNNN",
                            "title": "Nu", "artists": ["New Artist"], "dur": "4:00"}])
        r = self.run_add(sup, bad)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self._read(self.archive), self.data)

    # ---------- check_archive: rileva le corruzioni ----------

    def test_check_archive_catches_bad_counts(self):
        self.data["metadata"]["unique_tracks"] = 99
        self._write(self.archive, self.data)
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("unique_tracks", r.stdout)

    def test_check_archive_catches_missing_enrichment(self):
        del self.data["tracks_flat"][0]["mood"]
        self._write(self.archive, self.data)
        r = self.run_check()
        self.assertEqual(r.returncode, 1)
        self.assertIn("mood", r.stdout)


class UnitTest(unittest.TestCase):
    """Unit test delle funzioni pure di add_playlist (importato come modulo)."""

    @classmethod
    def setUpClass(cls):
        import importlib.util
        spec = importlib.util.spec_from_file_location("add_playlist", ADD)
        cls.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.m)

    def test_parse_dur(self):
        self.assertEqual(self.m.parse_dur("3:30"), 210)
        self.assertEqual(self.m.parse_dur("10:05"), 605)
        self.assertIsNone(self.m.parse_dur("boh"))

    def test_playlist_range_label(self):
        self.assertEqual(self.m.playlist_range_label([1, 2, 3]),
                         "#1 - #3 (3 New Release Playlist consecutive)")
        self.assertIn("+ 1 extra (#101)", self.m.playlist_range_label([1, 2, 101]))
        self.assertIn("con gap [2]", self.m.playlist_range_label([1, 3]))


if __name__ == "__main__":
    unittest.main()
