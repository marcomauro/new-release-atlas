#!/usr/bin/env python3
"""
build_graph.py — costruisce public/graph.json a partire dall'archivio
arricchito con i generi (spotify_archive_genres.json).

Uso:
    python scripts/build_graph.py \
        --input data/spotify_archive_genres.json \
        --output public/graph.json

Lo script è idempotente: rigenera l'intero grafo dallo stato corrente
dell'archivio. Per il workflow settimanale basta aggiornare l'archivio
arricchito e rilanciare questo script.

Schema di output:
    {
      "nodes": [{id,title,artist,artists,url,duration,genres,genre,community,playlists,degree,
                 era,era_norm,genre_count,bridging,artist_track_count,duration_sec,
                 is_bridge?,is_remix?,remixer?,is_instrumental?,is_live?,is_interlude?,   # derivati (Fase 1)
                 bpm?,key?,mode?,camelot?,energy?,valence?,year?}],                        # audio (enrich_audio.py)
      "links": [{source,target,weight}],
      "genres": [genre, ...],          # ordinati per frequenza (= indice cluster)
      "meta":   {unique_tracks,edges,genres}
    }
I campi con "?" sono presenti solo quando veri/disponibili (degradazione morbida).
"""
import argparse
import json
import os
import random
import re
from collections import defaultdict, Counter
from itertools import combinations

# --- campi derivati dal titolo (deterministici, nessuna rete) -------------
_RE_REMIX = re.compile(r"\b(remix|rework|re-work|edit|flip|reprise|version)\b", re.I)
# "(Xyz Remix)" / "[Xyz Rework]" / "- Xyz Remix" -> cattura il remixer "Xyz"
_RE_REMIXER = re.compile(
    r"[(\[\-–]\s*([^()\[\]\-–]+?)\s+(?:remix|rework|re-work|edit|flip)\s*[)\]]?\s*$", re.I)
_RE_INSTR = re.compile(r"\binstrumental\b", re.I)
_RE_LIVE = re.compile(r"[(\[\-–]\s*live\b|\blive (?:at|in|from)\b", re.I)
_RE_INTER = re.compile(r"\b(interlude|intro|outro|skit|prelude)\b", re.I)


def title_flags(title: str) -> dict:
    """Flag di 'forma' del brano estratti dal titolo; presenti solo se veri."""
    t = title or ""
    out = {}
    if _RE_REMIX.search(t):
        out["is_remix"] = True
        m = _RE_REMIXER.search(t)
        if m:
            out["remixer"] = m.group(1).strip()
    if _RE_INSTR.search(t):
        out["is_instrumental"] = True
    if _RE_LIVE.search(t):
        out["is_live"] = True
    if _RE_INTER.search(t):
        out["is_interlude"] = True
    return out


def build(archive: dict, seed: int = 7) -> dict:
    tracks = archive["tracks_flat"]

    # --- dedup per track id, accumulando le playlist di apparizione ---
    by_id = {}
    for t in tracks:
        tid = t["spotify_track_id"]
        if tid not in by_id:
            by_id[tid] = {
                "id": tid,
                "title": t["title"],
                "artists": t["artists"],
                "primary_artist": t["primary_artist"],
                "url": t["spotify_url"],
                "duration": t["duration"],
                "duration_sec": t.get("duration_sec"),
                "genres": t.get("genres", ["unknown"]),
                "genre_primary": t.get("genre_primary", "unknown"),
                "playlists": set(),
                # campi audio (presenti solo dopo enrich_audio.py); None se assenti
                "audio": {k: t[k] for k in ("bpm", "key", "mode", "camelot", "energy", "valence", "year")
                          if t.get(k) is not None},
            }
        by_id[tid]["playlists"].add(t["playlist_number"])

    nodes = list(by_id.values())
    rng = random.Random(seed)
    edges = defaultdict(float)

    # 1) artista condiviso (forte) ----------------------------------------
    artist_to = defaultdict(list)
    for n in nodes:
        for a in n["artists"]:
            artist_to[a].append(n["id"])
    for ids in artist_to.values():
        for x, y in combinations(sorted(set(ids)), 2):
            edges[tuple(sorted((x, y)))] += 3.0

    # 2) genere primario condiviso (medio, kNN sparso) --------------------
    genre_to = defaultdict(list)
    for n in nodes:
        genre_to[n["genre_primary"]].append(n["id"])
    for ids in genre_to.values():
        ids = sorted(set(ids))
        if len(ids) < 2:
            continue
        k = 3 if len(ids) > 10 else 2
        for nid in ids:
            peers = rng.sample([x for x in ids if x != nid], min(k, len(ids) - 1))
            for p in peers:
                edges[tuple(sorted((nid, p)))] += 1.2

    # 3) genere secondario condiviso (leggero) ----------------------------
    for n in nodes:
        if len(n["genres"]) < 2:
            continue
        sec = n["genres"][1]
        cand = [x for x in genre_to.get(sec, []) if x != n["id"]]
        for p in rng.sample(cand, min(2, len(cand))):
            edges[tuple(sorted((n["id"], p)))] += 0.6

    # 4) stessa playlist (debole, finestra scorrevole) --------------------
    pl_to = defaultdict(list)
    for n in nodes:
        for p in n["playlists"]:
            pl_to[p].append(n["id"])
    for ids in pl_to.values():
        ids = sorted(set(ids))
        for i in range(len(ids)):
            for j in range(i + 1, min(i + 3, len(ids))):
                edges[tuple(sorted((ids[i], ids[j])))] += 0.3

    # --- indice cluster = genere ordinato per frequenza ------------------
    genre_order = [g for g, _ in Counter(n["genre_primary"] for n in nodes).most_common()]
    gidx = {g: i for i, g in enumerate(genre_order)}

    deg = defaultdict(int)
    for (x, y) in edges:
        deg[x] += 1
        deg[y] += 1

    # --- campi derivati (Fase 1): era, ponti tra generi, prominenza ------
    # era = prima playlist di apparizione (le playlist sono cronologiche);
    # era_norm normalizza 0..1 sull'intervallo presente nell'archivio.
    all_pl = [p for n in nodes for p in n["playlists"]]
    min_pl, max_pl = min(all_pl), max(all_pl)
    span = max(1, max_pl - min_pl)

    # bridging = frazione degli archi che escono verso un ALTRO genere primario
    genre_of = {n["id"]: n["genre_primary"] for n in nodes}
    cross = defaultdict(int)
    for (x, y) in edges:
        if genre_of[x] != genre_of[y]:
            cross[x] += 1
            cross[y] += 1

    # prominenza artista = numero di brani unici del primary_artist in archivio
    artist_tracks = Counter(n["primary_artist"] for n in nodes)

    def derived(n):
        era = min(n["playlists"])
        d = {
            "era": era,
            "era_norm": round((era - min_pl) / span, 3),
            "genre_count": len(n["genres"]),
            "bridging": round(cross[n["id"]] / deg[n["id"]], 3) if deg[n["id"]] else 0.0,
            "artist_track_count": artist_tracks[n["primary_artist"]],
        }
        if n.get("duration_sec") is not None:
            d["duration_sec"] = n["duration_sec"]
        if len(n["genres"]) >= 2:
            d["is_bridge"] = True
        d.update(title_flags(n["title"]))
        return d

    out_nodes = [{
        "id": n["id"], "title": n["title"], "artist": n["primary_artist"],
        "artists": n["artists"], "url": n["url"], "duration": n["duration"],
        "genres": n["genres"], "genre": n["genre_primary"],
        "community": gidx[n["genre_primary"]],
        "playlists": sorted(n["playlists"]), "degree": deg[n["id"]],
        # campi derivati (era, ponti, forma dal titolo, prominenza)
        **derived(n),
        # campi audio inclusi solo quando presenti (degradazione morbida)
        **n.get("audio", {}),
    } for n in nodes]

    out_links = [{"source": x, "target": y, "weight": round(w, 2)}
                 for (x, y), w in edges.items()]

    return {
        "nodes": out_nodes,
        "links": out_links,
        "genres": genre_order,
        "meta": {
            "unique_tracks": len(out_nodes),
            "edges": len(out_links),
            "genres": len(genre_order),
        },
    }


def main():
    ap = argparse.ArgumentParser()
    # se non specificato: usa l'archivio con audio se esiste, altrimenti i generi
    ap.add_argument("--input", default=None)
    ap.add_argument("--output", default="public/graph.json")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    inp = args.input
    if inp is None:
        inp = next((c for c in ("data/spotify_archive_features.json",
                                "data/spotify_archive_genres.json") if os.path.exists(c)),
                   "data/spotify_archive_genres.json")

    with open(inp, encoding="utf-8") as f:
        archive = json.load(f)

    graph = build(archive, seed=args.seed)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, separators=(",", ":"))

    m = graph["meta"]
    print(f"OK  {m['unique_tracks']} nodi · {m['edges']} archi · {m['genres']} generi")
    print(f"    scritto in {args.output}")


if __name__ == "__main__":
    main()
