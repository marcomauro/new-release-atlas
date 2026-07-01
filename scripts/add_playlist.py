#!/usr/bin/env python3
"""
add_playlist.py — inclusione automatizzata di nuove playlist nell'archivio live.

Automatizza la "Fase B" di docs/ADDING_PLAYLISTS.md: prende i due file di
input della Fase A e fa merge + validazione + aggiornamento metadata su
data/spotify_archive_enriched.json (la sorgente live della mappa).

Uso:
    python3 scripts/add_playlist.py --support support.json [--char char.json]
                                    [--dry-run] [--build]

Input:
    support.json — tracklist grezza (una entry per occorrenza):
        {
          "playlist_ids":   { "37": "<spotify_playlist_id>", ... },
          "playlist_names": { "37": "New Release Friday #37", ... },   # opzionale
          "tracks": [
            { "pl": 37, "pos": 1, "id": "<spotify_track_id>",
              "title": "...", "artists": ["..."], "dur": "m:ss" }
          ]
        }
    char.json — caratterizzazione expert dei SOLI brani nuovi, keyed by id:
        { "<id>": { "G": [generi], "g": "Macro", "sg": [subgenres],
                    "m": [moods], "p": [e,v,d,a,i], "bpm": 122, "src": "..." } }

Comportamento:
    - id già in archivio  -> RIUSA la caratterizzazione esistente (char non serve);
      l'occorrenza viene comunque aggiunta (duplicato cross-playlist, annotato).
    - id nuovo senza entry in char -> STOP con il report degli id mancanti
      (è la to-do list per il passaggio di caratterizzazione expert/AI).
    - genere fuori dalla tassonomia corrente -> WARN (nuovo genere = va aggiunto
      colore/label in src/MusicNetwork.jsx e sinonimi in src/playlist.js).
    - le playlist preesistenti restano byte-identiche (si fa solo append);
      backup .bak dell'archivio prima di scrivere.

Exit code: 0 ok · 1 errore di validazione · 2 caratterizzazioni mancanti.
Solo stdlib, idempotente sui numeri playlist (rifiuta un numero già presente).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone

ARCHIVE = "data/spotify_archive_enriched.json"
MOOD_KEYS = ["energy", "valence", "danceability", "acousticness", "instrumentalness"]
EXTRA_THRESHOLD = 100  # numeri >= 100 = playlist "extra" fuori serie cronologica


def die(msg, code=1):
    print(f"ERRORE: {msg}", file=sys.stderr)
    sys.exit(code)


def warn(msg):
    print(f"  WARN  {msg}")


def parse_dur(d):
    """'m:ss' -> secondi (int) oppure None se non parsabile."""
    try:
        m, s = str(d).split(":")
        return int(m) * 60 + int(s)
    except (ValueError, AttributeError):
        return None


def load_json(path, what):
    if not os.path.exists(path):
        die(f"{what} non trovato: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate_char_entry(tid, c, taxonomy):
    """Valida una entry di char.json; ritorna la lista dei problemi (vuota = ok)."""
    probs = []
    G = c.get("G")
    if not isinstance(G, list) or not G:
        probs.append("G mancante o vuoto (serve almeno il genere primario)")
    else:
        for g in G:
            if g not in taxonomy:
                warn(f"{tid}: genere '{g}' fuori tassonomia corrente "
                     f"(nuovo genere? -> serve colore/label nel front-end)")
    p = c.get("p")
    if not isinstance(p, list) or len(p) != len(MOOD_KEYS):
        probs.append(f"p deve avere {len(MOOD_KEYS)} valori 0-1 (energy/valence/dance/acoustic/instr)")
    elif not all(isinstance(x, (int, float)) and 0 <= x <= 1 for x in p):
        probs.append("p contiene valori fuori range 0-1")
    if not isinstance(c.get("m"), list) or not c.get("m"):
        probs.append("m (mood descrittivi) mancante o vuoto")
    if not isinstance(c.get("sg"), list) or not c.get("sg"):
        probs.append("sg (subgenres) mancante o vuoto")
    if "bpm" in c and c["bpm"] is not None and not isinstance(c["bpm"], (int, float)):
        probs.append("bpm deve essere numerico (o omesso)")
    return probs


def enrichment_from_char(c):
    """Costruisce i campi di arricchimento del master-schema da una entry char."""
    G = list(c["G"])
    sg = list(c.get("sg") or [])
    macro = (c.get("g") or "").strip().lower()
    if macro and macro not in [s.lower() for s in sg]:
        sg = [macro] + sg
    return {
        "genres": G,
        "genre_primary": G[0],
        "subgenres": sg,
        "mood": list(c.get("m") or []),
        "mood_parameters": {k: float(v) for k, v in zip(MOOD_KEYS, c["p"])},
        "bpm": c.get("bpm"),
        "bpm_source": c.get("src") or "estimated",
    }


def enrichment_from_existing(t):
    """Estrae l'arricchimento da una traccia già in archivio (riuso)."""
    return {k: t.get(k) for k in
            ("genres", "genre_primary", "subgenres", "mood",
             "mood_parameters", "bpm", "bpm_source")}


def playlist_range_label(numbers):
    """Ricostruisce la label playlist_range: serie consecutiva + eventuali extra."""
    serie = sorted(n for n in numbers if n < EXTRA_THRESHOLD)
    extra = sorted(n for n in numbers if n >= EXTRA_THRESHOLD)
    label = f"#1 - #{serie[-1]} ({len(serie)} New Release Playlist consecutive)"
    gaps = [n for n in range(serie[0], serie[-1] + 1) if n not in set(serie)]
    if gaps:
        label += f" con gap {gaps}"
    if extra:
        label += f" + {len(extra)} extra ({', '.join('#' + str(n) for n in extra)})"
    return label


def main():
    ap = argparse.ArgumentParser(description="Merge di nuove playlist nell'archivio enriched.")
    ap.add_argument("--support", required=True, help="tracklist grezza (Fase A, file 1)")
    ap.add_argument("--char", default=None, help="caratterizzazioni dei brani nuovi (Fase A, file 2)")
    ap.add_argument("--archive", default=ARCHIVE)
    ap.add_argument("--dry-run", action="store_true", help="solo report, non scrive nulla")
    ap.add_argument("--build", action="store_true", help="rigenera public/graph.json dopo il merge")
    args = ap.parse_args()

    support = load_json(args.support, "support.json")
    char = load_json(args.char, "char.json") if args.char else {}
    archive = load_json(args.archive, "archivio enriched")

    # --- stato attuale dell'archivio -------------------------------------
    existing_by_id = {}
    occ_pls = {}  # id -> set dei numeri playlist in cui il brano appare
    for t in archive["tracks_flat"]:
        existing_by_id.setdefault(t["spotify_track_id"], t)
        occ_pls.setdefault(t["spotify_track_id"], set()).add(t["playlist_number"])
    existing_numbers = {p["playlist_number"] for p in archive["playlists"]}
    taxonomy = sorted({t["genre_primary"] for t in archive["tracks_flat"]})
    titles_index = {}
    for t in archive["tracks_flat"]:
        titles_index.setdefault(t["title"].strip().lower(), set()).add(t["spotify_track_id"])

    # --- validazione support ----------------------------------------------
    tracks_in = support.get("tracks")
    pl_ids = {int(k): v for k, v in (support.get("playlist_ids") or {}).items()}
    pl_names = {int(k): v for k, v in (support.get("playlist_names") or {}).items()}
    if not tracks_in:
        die("support.json senza 'tracks'")
    new_numbers = sorted({t["pl"] for t in tracks_in})
    for n in new_numbers:
        if n in existing_numbers:
            die(f"playlist #{n} già presente in archivio (numeri esistenti fino a "
                f"#{max(x for x in existing_numbers if x < EXTRA_THRESHOLD)})")
        if n not in pl_ids:
            die(f"playlist #{n}: manca lo spotify_playlist_id in playlist_ids")
    for i, t in enumerate(tracks_in):
        for k in ("pl", "pos", "id", "title", "artists", "dur"):
            if k not in t:
                die(f"tracks[{i}] senza campo '{k}'")

    # --- nuovo vs riuso; copertura char ------------------------------------
    ids_in = [t["id"] for t in tracks_in]
    new_ids = sorted({i for i in ids_in if i not in existing_by_id})
    reused_ids = sorted({i for i in ids_in if i in existing_by_id})
    missing = [i for i in new_ids if i not in char]
    if missing:
        print(f"\nCARATTERIZZAZIONI MANCANTI ({len(missing)} brani nuovi senza entry in char.json):")
        by_id = {t["id"]: t for t in tracks_in}
        for i in missing:
            t = by_id[i]
            print(f"  {i}  #{t['pl']}/{t['pos']:>2}  {t['title']} — {', '.join(t['artists'])}")
        print("\n-> Caratterizza questi brani (passaggio expert/AI) e rilancia.")
        sys.exit(2)

    char_problems = {}
    for i in new_ids:
        probs = validate_char_entry(i, char[i], taxonomy)
        if probs:
            char_problems[i] = probs
    if char_problems:
        for i, probs in char_problems.items():
            for p in probs:
                print(f"  FAIL  char[{i}]: {p}")
        die("char.json non valido")

    unused_char = [i for i in char if i not in new_ids]
    if unused_char:
        warn(f"{len(unused_char)} entry di char.json ignorate (id già in archivio o non nel support): "
             + ", ".join(unused_char[:5]) + ("…" if len(unused_char) > 5 else ""))

    # --- snapshot per la garanzia di non-regressione ------------------------
    before_playlists = json.dumps(archive["playlists"], ensure_ascii=False, sort_keys=True)
    n_pl_before = len(archive["playlists"])
    n_occ_before = len(archive["tracks_flat"])
    n_uniq_before = len(existing_by_id)

    # --- costruzione occorrenze master-schema ------------------------------
    cross_dups, new_occurrences = [], []
    for n in new_numbers:
        pl_tracks = sorted((t for t in tracks_in if t["pl"] == n), key=lambda t: t["pos"])
        name = pl_names.get(n) or (f"New Release Friday #{n}" if n < EXTRA_THRESHOLD else f"Extra #{n}")
        built = []
        for t in pl_tracks:
            tid = t["id"]
            enrich = (enrichment_from_existing(existing_by_id[tid])
                      if tid in existing_by_id else enrichment_from_char(char[tid]))
            occ = {
                "playlist_number": n,
                "playlist_name": name,
                "playlist_id": pl_ids[n],
                "position_in_playlist": t["pos"],
                "title": t["title"],
                "artists": list(t["artists"]),
                "primary_artist": t["artists"][0],
                "duration": t["dur"],
                "duration_sec": parse_dur(t["dur"]),
                "spotify_track_id": tid,
                "spotify_uri": f"spotify:track:{tid}",
                "spotify_url": f"https://open.spotify.com/track/{tid}",
                **enrich,
            }
            built.append(occ)
            if tid in occ_pls:
                occ_pls[tid].add(n)
                cross_dups.append({
                    "spotify_track_id": tid, "title": t["title"],
                    "playlists": sorted(occ_pls[tid]),
                })
            else:
                occ_pls[tid] = {n}
                # falso duplicato: stesso titolo, id diverso -> segnala, NON unifica
                twins = titles_index.get(t["title"].strip().lower(), set()) - {tid}
                if twins:
                    warn(f"possibile falso duplicato: '{t['title']}' ha id diversi "
                         f"({tid} vs {', '.join(sorted(twins))}) -> tenuti separati")
                existing_by_id[tid] = occ  # visibile ai riusi delle playlist successive
        new_occurrences.append((n, name, built))

    # --- report -------------------------------------------------------------
    total_new_occ = sum(len(b) for _, _, b in new_occurrences)
    print(f"\nMERGE PREVISTO — archivio: {n_pl_before} playlist / {n_occ_before} occorrenze / {n_uniq_before} uniche")
    for n, name, built in new_occurrences:
        n_new = sum(1 for o in built if o["spotify_track_id"] in {i for i in new_ids})
        print(f"  + #{n} '{name}': {len(built)} brani ({n_new} nuovi, {len(built)-n_new} riusati)")
    if cross_dups:
        print(f"  duplicati cross-playlist annotati: {len(cross_dups)}")
    if args.dry_run:
        print("\n--dry-run: nessuna scrittura.")
        return

    # --- merge --------------------------------------------------------------
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for n, name, built in new_occurrences:
        archive["playlists"].append({
            "playlist_number": n, "playlist_name": name, "playlist_id": pl_ids[n],
            "spotify_url": f"https://open.spotify.com/playlist/{pl_ids[n]}",
            "description": "", "date": None, "track_count": len(built),
            "tracks": [{k: v for k, v in o.items()
                        if k not in ("playlist_number", "playlist_name", "playlist_id")}
                       for o in built],
        })
        archive["tracks_flat"].extend(built)

    md = archive["metadata"]
    uniq = {t["spotify_track_id"] for t in archive["tracks_flat"]}
    artists = {a for t in archive["tracks_flat"] for a in t["artists"]}
    numbers = sorted({p["playlist_number"] for p in archive["playlists"]})
    md["playlist_range"] = playlist_range_label(numbers)
    md["total_tracks_with_duplicates"] = len(archive["tracks_flat"])
    md["unique_tracks"] = len(uniq)
    md["unique_artists"] = len(artists)
    seen, per_artist = set(), Counter()
    for t in archive["tracks_flat"]:
        if t["spotify_track_id"] in seen:
            continue
        seen.add(t["spotify_track_id"])
        per_artist[t["primary_artist"]] += 1
    md["top_artists"] = [[a, c] for a, c in per_artist.most_common(20)]
    if cross_dups:
        md.setdefault("cross_playlist_duplicates", []).extend(cross_dups)
    md["merged_at"] = now
    md["merge_note"] = (f"add_playlist.py: aggiunte {[f'#{n}' for n in new_numbers]} "
                        f"({total_new_occ} occorrenze, {len(new_ids)} brani nuovi)")

    # --- validazione post-merge ----------------------------------------------
    assert len(archive["playlists"]) == n_pl_before + len(new_numbers)
    assert len(archive["tracks_flat"]) == n_occ_before + total_new_occ
    after_prev = json.dumps(archive["playlists"][:n_pl_before], ensure_ascii=False, sort_keys=True)
    if after_prev != before_playlists:
        die("le playlist preesistenti sono cambiate: merge annullato (bug!)")
    for t in archive["tracks_flat"][-total_new_occ:]:
        mp = t.get("mood_parameters") or {}
        if (not t.get("genres") or not t.get("genre_primary")
                or sorted(mp.keys()) != sorted(MOOD_KEYS)):
            die(f"occorrenza {t['spotify_track_id']} senza arricchimento completo")

    # --- scrittura (con backup) ----------------------------------------------
    shutil.copy2(args.archive, args.archive + ".bak")
    with open(args.archive, "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=1)
    print(f"\nOK  archivio aggiornato ({args.archive}; backup .bak scritto)")
    print(f"    ora: {len(archive['playlists'])} playlist / {len(archive['tracks_flat'])} occorrenze / "
          f"{md['unique_tracks']} uniche / range: {md['playlist_range']}")

    if args.build:
        print("\nRigenero public/graph.json …")
        subprocess.run([sys.executable, "scripts/build_graph.py"], check=True)
        print("Fatto. Prossimi passi: npm run build → commit → push (CI ripubblica).")


if __name__ == "__main__":
    main()
