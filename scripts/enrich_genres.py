#!/usr/bin/env python3
"""
enrich_genres.py — aggiunge i campi `genres` e `genre_primary` a ogni traccia
di un archivio Spotify grezzo, usando la classificazione per-artista di
genre_map.py più inferenza da contesto per gli artisti sconosciuti.

Uso tipico (workflow settimanale):
    python scripts/enrich_genres.py \
        --input data/spotify_archive.json \
        --output data/spotify_archive_genres.json

Opzioni utili:
    --overrides data/genre_overrides.json
        File JSON {"Nome Artista": ["genere1", "genere2"], ...} con cui
        estendere/correggere la mappa SENZA toccare genre_map.py. Caricato
        prima dell'elaborazione. È il posto giusto dove aggiungere i nuovi
        artisti che lo script segnala come non classificati.

    --report-missing data/missing_artists.json
        Scrive l'elenco degli artisti rimasti 'unknown' (con il conteggio di
        tracce e i co-autori noti, per aiutarti a classificarli a mano).

    --fail-on-missing N
        Esce con codice 1 se restano più di N artisti non classificati.
        Utile in CI per accorgersi quando una nuova playlist introduce
        artisti sconosciuti.

Note:
    - Lo script NON usa le API di Spotify e non richiede alcuna credenziale.
    - L'inferenza da contesto: se un artista è sconosciuto ma collabora, sulla
      stessa traccia, con artisti noti, eredita i loro generi (peso ridotto).
      Resta 'unknown' solo se non c'è alcun appiglio.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict

import genre_map as gm


def build_collaborator_context(tracks):
    """
    Per ogni artista sconosciuto, raccoglie i generi noti dei co-autori con cui
    appare sulle stesse tracce. Restituisce dict: artista_unknown -> [generi].
    """
    cooc_genres = defaultdict(Counter)
    for t in tracks:
        arts = t["artists"]
        unknowns = [a for a in arts if not gm.is_known(a)]
        if not unknowns:
            continue
        # generi noti presenti sulla traccia
        ctx = Counter()
        for a in arts:
            if gm.is_known(a):
                for i, g in enumerate(gm.artist_genres(a)):
                    ctx[g] += (3 - i) if i < 3 else 1
        for u in unknowns:
            cooc_genres[u].update(ctx)

    inferred = {}
    for artist, counter in cooc_genres.items():
        if counter:
            # primi 2 generi per peso come profilo inferito
            inferred[artist] = [g for g, _ in counter.most_common(2)]
    return inferred


def enrich(archive, overrides=None):
    if overrides:
        gm.add_artists(overrides)

    tracks = archive["tracks_flat"]
    context = build_collaborator_context(tracks)

    def process(track):
        genres, primary = gm.track_genres(track["artists"], context)
        track["genres"] = genres
        track["genre_primary"] = primary
        return track

    for t in tracks:
        process(t)
    for pl in archive.get("playlists", []):
        for t in pl.get("tracks", []):
            process(t)

    # --- aggiorna metadata ---
    dist = Counter(t["genre_primary"] for t in tracks)
    presence = Counter()
    for t in tracks:
        for g in t["genres"]:
            presence[g] += 1

    all_artists = {a for t in tracks for a in t["artists"]}
    _, missing = gm.coverage(all_artists)

    archive.setdefault("metadata", {})["genre_inference"] = {
        "method": "classificazione per-artista (genre_map.py) + inferenza da contesto collaborazioni",
        "uses_spotify_api": False,
        "artists_total": len(all_artists),
        "artists_unclassified": len(missing),
        "taxonomy": gm.TAXONOMY[:-1],
        "primary_genre_distribution": dict(dist.most_common()),
        "genre_presence_any": dict(presence.most_common()),
    }
    return archive, missing, context


def missing_report(tracks, missing):
    """Costruisce un report leggibile degli artisti non classificati."""
    track_count = Counter()
    collaborators = defaultdict(set)
    for t in tracks:
        for a in t["artists"]:
            if a in missing:
                track_count[a] += 1
                for other in t["artists"]:
                    if other != a and gm.is_known(other):
                        collaborators[a].add(other)
    return {
        a: {
            "tracks": track_count[a],
            "known_collaborators": sorted(collaborators[a]),
        }
        for a in missing
    }


def main():
    ap = argparse.ArgumentParser(description="Arricchisce un archivio Spotify con i generi inferiti.")
    ap.add_argument("--input", default="data/spotify_archive.json")
    ap.add_argument("--output", default="data/spotify_archive_genres.json")
    ap.add_argument("--overrides", default=None, help="JSON artista->generi per estendere la mappa")
    ap.add_argument("--report-missing", default=None, help="dove scrivere l'elenco artisti non classificati")
    ap.add_argument("--fail-on-missing", type=int, default=None, help="esci con errore se i mancanti superano N")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        archive = json.load(f)

    overrides = None
    if args.overrides:
        try:
            with open(args.overrides, encoding="utf-8") as f:
                overrides = json.load(f)
            print(f"overrides caricati: {len(overrides)} artisti da {args.overrides}")
        except FileNotFoundError:
            print(f"(nessun file overrides in {args.overrides}, proseguo senza)")

    archive, missing, _ = enrich(archive, overrides)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=2)

    total = archive["metadata"]["genre_inference"]["artists_total"]
    covered = total - len(missing)
    print(f"OK  copertura {covered}/{total} artisti ({100*covered/total:.1f}%)")
    print(f"    scritto in {args.output}")

    if missing:
        print(f"\nATTENZIONE: {len(missing)} artisti non classificati (restano 'unknown'):")
        for a in missing[:20]:
            print(f"    - {a}")
        if len(missing) > 20:
            print(f"    … e altri {len(missing)-20}")
        print("    -> aggiungili a genre_map.py o al file --overrides")

    if args.report_missing and missing:
        report = missing_report(archive["tracks_flat"], missing)
        with open(args.report_missing, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"    report dettagliato in {args.report_missing}")

    if args.fail_on_missing is not None and len(missing) > args.fail_on_missing:
        print(f"\nERRORE: {len(missing)} mancanti > soglia {args.fail_on_missing}")
        sys.exit(1)


if __name__ == "__main__":
    main()
