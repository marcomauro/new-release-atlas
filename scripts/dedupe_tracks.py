#!/usr/bin/env python3
"""
dedupe_tracks.py — unifica due id Spotify che sono la STESSA registrazione.

Spotify pubblica spesso lo stesso brano sotto id diversi (singolo, album,
riedizione, "remastered"): se entrambe le uscite finiscono in playlist
diverse, l'archivio si ritrova due tracce uniche per una sola canzone e la
mappa mostra due nodi gemelli. add_playlist.py le tiene separate per
policy (id diverso = registrazione diversa) e stampa un WARN: la decisione
se unificarle è del proprietario dei dati. Questo script la esegue.

Uso:
    python3 scripts/dedupe_tracks.py --pair <id_canonico> <id_duplicato> \
                                     [--pair ...] [--dry-run] [--build]

Comportamento (non distruttivo):
    - Le OCCORRENZE del duplicato vengono riscritte sull'id canonico
      (spotify_track_id / uri / url) e l'arricchimento del canonico viene
      copiato su di esse: è la stessa politica che add_playlist.py applica
      ai duplicati cross-playlist.
    - Se il canonico ha un campo VUOTO (tipicamente bpm) e il duplicato lo
      ha, il valore viene COLMATO su tutte le occorrenze: si aggiunge
      informazione, non si distrugge.
    - Nessuna occorrenza viene rimossa: la traccia resta presente in tutte
      le playlist in cui compariva (diventa un duplicato cross-playlist,
      annotato in metadata).
    - metadata ricalcolato (unique_tracks, unique_artists, top_artists,
      cross_playlist_duplicates) + nota di dedup con lo storico degli id
      uniti, così il legame con l'id ritirato non va perso.
    - Backup .bak prima di scrivere.

Solo stdlib. Exit 0 ok · 1 errore di validazione.
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
ENRICH_KEYS = ("genres", "genre_primary", "subgenres", "mood",
               "mood_parameters", "bpm", "bpm_source")
ID_KEYS = ("spotify_track_id", "spotify_uri", "spotify_url")


def die(msg):
    print(f"ERRORE: {msg}", file=sys.stderr)
    sys.exit(1)


def load(path):
    if not os.path.exists(path):
        die(f"archivio non trovato: {path}")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def occurrences(archive, tid):
    return [t for t in archive["tracks_flat"] if t["spotify_track_id"] == tid]


def id_fields(tid):
    return {
        "spotify_track_id": tid,
        "spotify_uri": f"spotify:track:{tid}",
        "spotify_url": f"https://open.spotify.com/track/{tid}",
    }


def main():
    ap = argparse.ArgumentParser(description="Unifica id Spotify della stessa registrazione.")
    ap.add_argument("--pair", nargs=2, action="append", metavar=("CANONICAL", "DUPLICATE"),
                    required=True, help="id canonico + id da unificare (ripetibile)")
    ap.add_argument("--archive", default=ARCHIVE)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--build", action="store_true", help="rigenera public/graph.json")
    args = ap.parse_args()

    archive = load(args.archive)
    before_uniq = len({t["spotify_track_id"] for t in archive["tracks_flat"]})
    before_occ = len(archive["tracks_flat"])

    plan = []
    for canon, dup in args.pair:
        if canon == dup:
            die(f"id identici: {canon}")
        c_occ, d_occ = occurrences(archive, canon), occurrences(archive, dup)
        if not c_occ:
            die(f"id canonico non trovato in archivio: {canon}")
        if not d_occ:
            die(f"id duplicato non trovato in archivio: {dup}")

        c, d = c_occ[0], d_occ[0]
        # sanity: stessa registrazione? durata e artisti devono combaciare
        warn = []
        if c.get("duration_sec") != d.get("duration_sec"):
            warn.append(f"durate diverse ({c.get('duration_sec')}s vs {d.get('duration_sec')}s)")
        if set(c.get("artists") or []) != set(d.get("artists") or []):
            warn.append("liste artisti diverse")
        if c["title"].strip().lower() != d["title"].strip().lower():
            warn.append(f"titoli diversi ({c['title']!r} vs {d['title']!r})")
        for w in warn:
            print(f"  WARN  {canon} / {dup}: {w} — verifica che sia davvero la stessa registrazione")

        # arricchimento finale: quello del canonico, con i buchi colmati dal duplicato
        enrich = {k: c.get(k) for k in ENRICH_KEYS}
        filled = []
        for k in ENRICH_KEYS:
            if (enrich.get(k) in (None, [], {}, "")) and d.get(k) not in (None, [], {}, ""):
                enrich[k] = d[k]
                filled.append(k)

        plan.append({
            "canon": canon, "dup": dup, "enrich": enrich, "filled": filled,
            "title": c["title"],
            "canon_pls": sorted({t["playlist_number"] for t in c_occ}),
            "dup_pls": sorted({t["playlist_number"] for t in d_occ}),
        })

    print(f"\nDEDUP PREVISTO — archivio: {before_occ} occorrenze / {before_uniq} uniche")
    for p in plan:
        print(f"  {p['title']!r}")
        print(f"    canonico  {p['canon']}  (playlist {p['canon_pls']})")
        print(f"    unificato {p['dup']}  (playlist {p['dup_pls']})")
        if p["filled"]:
            print(f"    campi colmati dal duplicato: {', '.join(p['filled'])}")
    print(f"  -> tracce uniche: {before_uniq} - {len(plan)} = {before_uniq - len(plan)}")
    print("  -> occorrenze invariate (nessun brano rimosso dalle playlist)")

    if args.dry_run:
        print("\n--dry-run: nessuna scrittura.")
        return

    # --- riscrittura ------------------------------------------------------
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for p in plan:
        canon, dup, enrich = p["canon"], p["dup"], p["enrich"]
        newids = id_fields(canon)
        for t in archive["tracks_flat"]:
            if t["spotify_track_id"] in (canon, dup):
                t.update(newids)
                t.update(enrich)
        for pl in archive["playlists"]:
            for t in pl.get("tracks", []):
                if t.get("spotify_track_id") in (canon, dup):
                    t.update(newids)
                    t.update(enrich)

    # --- metadata ---------------------------------------------------------
    md = archive["metadata"]
    tf = archive["tracks_flat"]
    uniq = {t["spotify_track_id"] for t in tf}
    md["total_tracks_with_duplicates"] = len(tf)
    md["unique_tracks"] = len(uniq)
    md["unique_artists"] = len({a for t in tf for a in t["artists"]})
    seen, per_artist = set(), Counter()
    for t in tf:
        if t["spotify_track_id"] in seen:
            continue
        seen.add(t["spotify_track_id"])
        per_artist[t["primary_artist"]] += 1
    md["top_artists"] = [[a, c] for a, c in per_artist.most_common(20)]

    # cross-playlist duplicates ricalcolati da zero (l'unione ne crea di nuovi)
    pls_by_id, title_by_id = {}, {}
    for t in tf:
        pls_by_id.setdefault(t["spotify_track_id"], set()).add(t["playlist_number"])
        title_by_id.setdefault(t["spotify_track_id"], t["title"])
    md["cross_playlist_duplicates"] = [
        {"spotify_track_id": i, "title": title_by_id[i], "playlists": sorted(p)}
        for i, p in sorted(pls_by_id.items()) if len(p) > 1
    ]
    # storico: l'id ritirato resta tracciabile
    md.setdefault("deduped_reissues", []).extend([
        {"kept": p["canon"], "merged": p["dup"], "title": p["title"],
         "filled_from_merged": p["filled"], "at": now}
        for p in plan
    ])
    md["deduped_at"] = now
    md["dedup_note"] = (f"dedupe_tracks.py: unificati {len(plan)} id Spotify della stessa "
                        f"registrazione (riedizioni); occorrenze preservate")

    # --- validazione ------------------------------------------------------
    if len(tf) != before_occ:
        die("il numero di occorrenze è cambiato: dedup annullato (bug!)")
    if len(uniq) != before_uniq - len(plan):
        die(f"tracce uniche attese {before_uniq - len(plan)}, trovate {len(uniq)}")
    for p in plan:
        if occurrences(archive, p["dup"]):
            die(f"id duplicato ancora presente: {p['dup']}")

    shutil.copy2(args.archive, args.archive + ".bak")
    with open(args.archive, "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=1)
    print(f"\nOK  archivio aggiornato ({args.archive}; backup .bak scritto)")
    print(f"    ora: {len(archive['playlists'])} playlist / {len(tf)} occorrenze / "
          f"{md['unique_tracks']} uniche / {md['unique_artists']} artisti")

    if args.build:
        print("\nRigenero public/graph.json …")
        subprocess.run([sys.executable, "scripts/build_graph.py"], check=True)


if __name__ == "__main__":
    main()
