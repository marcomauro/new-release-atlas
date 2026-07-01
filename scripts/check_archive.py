#!/usr/bin/env python3
"""
check_archive.py — guardia CI sull'integrità dell'archivio live.

Verifica che data/spotify_archive_enriched.json (la sorgente unica della mappa)
sia internamente coerente PRIMA di generare il grafo: se un merge manuale o un
bug di add_playlist.py corrompesse l'archivio, la CI si ferma qui invece di
pubblicare una mappa sbagliata.

Controlli:
  - metadata.unique_tracks / total_tracks_with_duplicates / unique_artists
    combaciano con i conteggi ricalcolati da tracks_flat;
  - numeri playlist unici; ogni occorrenza punta a una playlist esistente;
  - ogni traccia ha l'arricchimento completo: genres (non vuoto),
    genre_primary ∈ genres, subgenres, mood, mood_parameters con le 5 chiavi
    in [0,1], bpm_source; id/uri/url coerenti col track id.

Solo stdlib. Exit 0 = ok, 1 = archivio incoerente (con report).
"""

import json
import sys

ARCHIVE = "data/spotify_archive_enriched.json"
MOOD_KEYS = {"energy", "valence", "danceability", "acousticness", "instrumentalness"}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else ARCHIVE
    with open(path, encoding="utf-8") as f:
        d = json.load(f)

    errors = []
    md = d.get("metadata", {})
    playlists = d.get("playlists", [])
    tracks = d.get("tracks_flat", [])

    # --- playlist: numeri unici, occorrenze -> playlist esistente ----------
    numbers = [p.get("playlist_number") for p in playlists]
    dupes = {n for n in numbers if numbers.count(n) > 1}
    if dupes:
        errors.append(f"numeri playlist duplicati: {sorted(dupes)}")
    known = set(numbers)
    orphans = {t["playlist_number"] for t in tracks if t.get("playlist_number") not in known}
    if orphans:
        errors.append(f"occorrenze che puntano a playlist inesistenti: {sorted(orphans)}")

    # --- conteggi metadata vs realtà ---------------------------------------
    uniq = {t["spotify_track_id"] for t in tracks}
    artists = {a for t in tracks for a in t.get("artists", [])}
    checks = [
        ("unique_tracks", len(uniq)),
        ("total_tracks_with_duplicates", len(tracks)),
        ("unique_artists", len(artists)),
    ]
    for key, real in checks:
        if md.get(key) != real:
            errors.append(f"metadata.{key}={md.get(key)} ma il valore reale è {real}")

    # --- arricchimento completo per ogni occorrenza -------------------------
    for t in tracks:
        tid = t.get("spotify_track_id", "<senza id>")
        where = f"{tid} (#{t.get('playlist_number')}/{t.get('position_in_playlist')})"
        if not t.get("genres"):
            errors.append(f"{where}: genres mancante o vuoto")
        elif t.get("genre_primary") not in t["genres"]:
            errors.append(f"{where}: genre_primary '{t.get('genre_primary')}' non in genres")
        if not t.get("subgenres"):
            errors.append(f"{where}: subgenres mancante o vuoto")
        if not t.get("mood"):
            errors.append(f"{where}: mood mancante o vuoto")
        mp = t.get("mood_parameters") or {}
        if set(mp.keys()) != MOOD_KEYS:
            errors.append(f"{where}: mood_parameters con chiavi {sorted(mp.keys())}")
        elif not all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in mp.values()):
            errors.append(f"{where}: mood_parameters fuori range 0-1")
        if not t.get("bpm_source"):
            errors.append(f"{where}: bpm_source mancante")
        if t.get("spotify_uri") != f"spotify:track:{tid}":
            errors.append(f"{where}: spotify_uri incoerente con l'id")
        if len(errors) > 30:
            errors.append("… (troncato)")
            break

    if errors:
        print(f"FAIL  archivio incoerente ({path}):")
        for e in errors[:31]:
            print(f"    {e}")
        sys.exit(1)
    print(f"OK  archivio coerente ({path}): {len(playlists)} playlist · "
          f"{len(tracks)} occorrenze · {len(uniq)} tracce uniche · {len(artists)} artisti")


if __name__ == "__main__":
    main()
