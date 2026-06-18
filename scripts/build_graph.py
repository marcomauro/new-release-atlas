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


# Pesi default dei legami — gerarchia ORIGINALE (quella con cui era stata
# sviluppata la distribuzione del grafo):
#   artista condiviso > genere primario > genere secondario > stessa playlist
# I componenti di ogni arco sono salvati separati ("c": [artista, primario,
# secondario, playlist]) così il front-end puo' ri-pesare al volo.
DEFAULT_LINK_WEIGHTS = {"primary": 1.2, "artist": 3.0, "secondary": 0.6, "playlist": 0.3}


_RE_ISODATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})")


def latest_update(archive: dict) -> str:
    """Data (YYYY-MM-DD) dell'ultimo aggiornamento dei brani: la più recente fra
    i timestamp ISO nel metadata dell'archivio (generated_at / enriched_at /
    extended_at* / merged_at ...). Riflette quando i brani sono stati toccati."""
    meta = archive.get("metadata", {})
    dates = []
    for v in meta.values():
        if isinstance(v, str):
            m = _RE_ISODATE.search(v)
            if m:
                dates.append(m.group(1))
    return max(dates) if dates else ""


def build(archive: dict, seed: int = 7) -> dict:
    tracks = archive["tracks_flat"]

    # --- dedup per track id, accumulando le playlist di apparizione ---
    by_id = {}
    for t in tracks:
        tid = t["spotify_track_id"]
        if tid not in by_id:
            mp = t.get("mood_parameters") or {}
            audio = {k: t[k] for k in (
                "bpm", "key", "mode", "camelot", "energy", "valence",
                "danceability", "acousticness", "instrumentalness", "loudness",
                "year", "popularity")
                if t.get(k) is not None}
            # mood_parameters (archivio arricchito): energy/valence/danceability/
            # acousticness/instrumentalness sono annidati qui, non top-level.
            for k in ("energy", "valence", "danceability", "acousticness", "instrumentalness"):
                if mp.get(k) is not None and k not in audio:
                    audio[k] = mp[k]
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
                # campi audio: mood_parameters arricchiti + eventuali audio feature.
                # isrc resta nell'archivio (identita'), non serve al front-end.
                "audio": audio,
                # nuovi descrittori dell'archivio arricchito (soft se assenti)
                "mood": t.get("mood") or [],
                "subgenres": t.get("subgenres") or [],
                "bpm_source": t.get("bpm_source"),
            }
        by_id[tid]["playlists"].add(t["playlist_number"])

    nodes = list(by_id.values())
    rng = random.Random(seed)
    # archi scomposti per CATEGORIA: c = [artista, genere_primario, genere_secondario, playlist]
    comp = defaultdict(lambda: [0, 0, 0, 0])

    # 1) artista condiviso ------------------------------------------------
    artist_to = defaultdict(list)
    for n in nodes:
        for a in n["artists"]:
            artist_to[a].append(n["id"])
    for ids in artist_to.values():
        for x, y in combinations(sorted(set(ids)), 2):
            comp[tuple(sorted((x, y)))][0] += 1

    # 2) genere primario condiviso (kNN sparso) ---------------------------
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
                comp[tuple(sorted((nid, p)))][1] += 1

    # 3) genere secondario condiviso --------------------------------------
    for n in nodes:
        if len(n["genres"]) < 2:
            continue
        sec = n["genres"][1]
        cand = [x for x in genre_to.get(sec, []) if x != n["id"]]
        for p in rng.sample(cand, min(2, len(cand))):
            comp[tuple(sorted((n["id"], p)))][2] += 1

    # 4) stessa playlist (finestra scorrevole) ----------------------------
    pl_to = defaultdict(list)
    for n in nodes:
        for p in n["playlists"]:
            pl_to[p].append(n["id"])
    for ids in pl_to.values():
        ids = sorted(set(ids))
        for i in range(len(ids)):
            for j in range(i + 1, min(i + 3, len(ids))):
                comp[tuple(sorted((ids[i], ids[j])))][3] += 1

    # peso totale di un arco dai componenti, coi pesi default (per layout + degree)
    W = DEFAULT_LINK_WEIGHTS
    def edge_weight(c):
        return c[0] * W["artist"] + c[1] * W["primary"] + c[2] * W["secondary"] + c[3] * W["playlist"]

    # --- indice cluster = genere ordinato per frequenza ------------------
    genre_order = [g for g, _ in Counter(n["genre_primary"] for n in nodes).most_common()]
    gidx = {g: i for i, g in enumerate(genre_order)}

    deg = defaultdict(int)
    for (x, y) in comp:
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
    for (x, y) in comp:
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
        # nuovi descrittori (mood/subgenres/bpm_source) inclusi solo se presenti
        **({"mood": n["mood"]} if n.get("mood") else {}),
        **({"subgenres": n["subgenres"]} if n.get("subgenres") else {}),
        **({"bpm_source": n["bpm_source"]} if n.get("bpm_source") else {}),
        # campi audio inclusi solo quando presenti (degradazione morbida)
        **n.get("audio", {}),
    } for n in nodes]

    # weight = peso default (per layout/back-compat); c = componenti per ri-pesare al volo
    out_links = [{"source": x, "target": y, "weight": round(edge_weight(c), 2), "c": c}
                 for (x, y), c in comp.items()]

    # --- info per il sottotitolo (numero playlist, range, ultimo aggiornamento) ---
    pl_numbers = sorted({p for n in nodes for p in n["playlists"]})
    n_playlists = len(archive.get("playlists", [])) or len(pl_numbers)
    playlist_range = f"#{pl_numbers[0]}–#{pl_numbers[-1]}" if pl_numbers else ""

    return {
        "nodes": out_nodes,
        "links": out_links,
        "genres": genre_order,
        "meta": {
            "unique_tracks": len(out_nodes),
            "edges": len(out_links),
            "genres": len(genre_order),
            # info playlist + data ultimo aggiornamento per il sottotitolo del front-end
            "playlists": n_playlists,
            "playlist_range": playlist_range,
            "updated": latest_update(archive),
            # pesi default per categoria; il front-end li usa come valori iniziali
            # dei controlli "pesi del percorso" e per ricalcolare i legami al volo.
            "linkWeights": DEFAULT_LINK_WEIGHTS,
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
        inp = next((c for c in ("data/spotify_archive_enriched.json",
                                "data/spotify_archive_features.json",
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
