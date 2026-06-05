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
      "nodes": [{id,title,artist,artists,url,duration,genres,genre,community,playlists,degree}],
      "links": [{source,target,weight}],
      "genres": [genre, ...],          # ordinati per frequenza (= indice cluster)
      "meta":   {unique_tracks,edges,genres}
    }
"""
import argparse
import json
import random
from collections import defaultdict, Counter
from itertools import combinations


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
                "genres": t.get("genres", ["unknown"]),
                "genre_primary": t.get("genre_primary", "unknown"),
                "playlists": set(),
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

    out_nodes = [{
        "id": n["id"], "title": n["title"], "artist": n["primary_artist"],
        "artists": n["artists"], "url": n["url"], "duration": n["duration"],
        "genres": n["genres"], "genre": n["genre_primary"],
        "community": gidx[n["genre_primary"]],
        "playlists": sorted(n["playlists"]), "degree": deg[n["id"]],
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
    ap.add_argument("--input", default="data/spotify_archive_genres.json")
    ap.add_argument("--output", default="public/graph.json")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        archive = json.load(f)

    graph = build(archive, seed=args.seed)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(graph, f, ensure_ascii=False, separators=(",", ":"))

    m = graph["meta"]
    print(f"OK  {m['unique_tracks']} nodi · {m['edges']} archi · {m['genres']} generi")
    print(f"    scritto in {args.output}")


if __name__ == "__main__":
    main()
