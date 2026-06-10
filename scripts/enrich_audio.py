#!/usr/bin/env python3
"""
enrich_audio.py — arricchisce i brani con bpm / key+mode / energy / valence / year.

DA ESEGUIRE IN LOCALE (richiede internet). Non gira in CI: il risultato viene
committato (come per i generi) e build_graph.py lo legge senza rete.

Pipeline:
    data/spotify_archive_genres.json  --(questo script)-->  data/spotify_archive_features.json

Fonti (gratuite, senza chiavi):
  - ReccoBeats  : audio-features per Spotify ID (tempo/key/mode/energy/valence)
  - Deezer      : anno di uscita + bpm di fallback + isrc  (match per durata)
Solo libreria standard Python (urllib). Idempotente: cache su disco, le
ri-esecuzioni scaricano solo i brani mancanti.

Esempi:
    # SPIKE: prova su 15 brani, mostra le coperture, non riscrive l'archivio
    python3 scripts/enrich_audio.py --limit 15 --dry-run --report

    # run completo -> scrive data/spotify_archive_features.json
    python3 scripts/enrich_audio.py --report
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error

IN_DEFAULT = "data/spotify_archive_genres.json"
OUT_DEFAULT = "data/spotify_archive_features.json"
CACHE_PATH = "data/.audio_cache.json"
OVERRIDES_PATH = "data/audio_overrides.json"

AUDIO_FIELDS = ("bpm", "key", "mode", "camelot", "energy", "valence", "year")

# Ruota Camelot per il mixaggio armonico (indice = pitch class 0..11, C=0).
CAMELOT_MAJOR = ["8B", "3B", "10B", "5B", "12B", "7B", "2B", "9B", "4B", "11B", "6B", "1B"]
CAMELOT_MINOR = ["5A", "12A", "7A", "2A", "9A", "4A", "11A", "6A", "1A", "8A", "3A", "10A"]


def to_camelot(key, mode):
    if not isinstance(key, int) or not (0 <= key <= 11) or mode not in ("major", "minor"):
        return None
    return (CAMELOT_MAJOR if mode == "major" else CAMELOT_MINOR)[key]


def http_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "new-release-atlas-enrich/1.0"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:  # rate limit: backoff
                time.sleep(2 ** attempt)
                continue
            return None
        except Exception:
            if attempt < 3:
                time.sleep(1 + attempt)
                continue
            return None
    return None


_SPID = re.compile(r"/track/([A-Za-z0-9]+)")


def _spotify_id_from_href(href):
    m = _SPID.search(href or "")
    return m.group(1) if m else None


def _parse_features(f):
    out = {}
    tempo = f.get("tempo") or f.get("bpm")
    if tempo:
        out["bpm"] = round(float(tempo))
    if f.get("energy") is not None:
        out["energy"] = round(float(f["energy"]), 3)
    if f.get("valence") is not None:
        out["valence"] = round(float(f["valence"]), 3)
    k = f.get("key")
    if isinstance(k, int) and 0 <= k <= 11:
        out["key"] = k
    m = f.get("mode")
    if m is not None:
        out["mode"] = "major" if (m == 1 or m == "major") else "minor"
    return out


def reccobeats_batch(ids, chunk=40):
    """Audio-features per molti Spotify ID in poche richieste (?ids=a,b,c).
    Evita il rate-limit. Mappa il risultato per id via href."""
    out = {}
    for i in range(0, len(ids), chunk):
        group = ids[i:i + chunk]
        url = "https://api.reccobeats.com/v1/audio-features?ids=" + urllib.parse.quote(",".join(group))
        data = http_json(url)
        items = (data.get("content") if isinstance(data, dict) else None) or \
                (data.get("audio_features") if isinstance(data, dict) else None) or \
                (data if isinstance(data, list) else [])
        for f in items or []:
            sid = _spotify_id_from_href(f.get("href", "")) or f.get("id")
            if sid:
                out[sid] = _parse_features(f)
        print(f"  reccobeats {min(i + chunk, len(ids))}/{len(ids)}")
        time.sleep(1.0)  # gentile con il rate-limit
    return out


_PAREN = re.compile(r"\((?:feat\.|with|prod\.).*?\)", re.I)


def from_deezer(title, primary_artist, duration_sec):
    """Anno + bpm di fallback + isrc, via ricerca con match per durata."""
    t = _PAREN.sub("", title or "").strip()
    q = urllib.parse.quote(f'artist:"{primary_artist}" track:"{t}"')
    data = http_json(f"https://api.deezer.com/search?q={q}&limit=10")
    cands = (data or {}).get("data", []) if isinstance(data, dict) else []
    if not cands:  # ricerca più larga
        q2 = urllib.parse.quote(f"{primary_artist} {t}")
        data = http_json(f"https://api.deezer.com/search?q={q2}&limit=10")
        cands = (data or {}).get("data", []) if isinstance(data, dict) else []
    best, bd = None, 1e9
    for it in cands:
        d = abs((it.get("duration") or 0) - (duration_sec or 0))
        if d < bd:
            bd, best = d, it
    if not best or bd > 6:  # nessun match affidabile per durata
        return {}
    det = http_json(f"https://api.deezer.com/track/{best['id']}")
    if not det:
        return {}
    out = {}
    rd = det.get("release_date") or (det.get("album") or {}).get("release_date")
    if rd and len(rd) >= 4 and rd[:4].isdigit():
        out["year"] = int(rd[:4])
    bpm = det.get("bpm")
    if bpm and bpm > 0:
        out["bpm"] = round(bpm)
    if det.get("isrc"):
        out["isrc"] = det["isrc"]
    return out


def enrich_one(track, sources, recc):
    rec = dict(recc or {})  # features ReccoBeats già pre-scaricate (batch)
    if "deezer" in sources:
        try:
            dz = from_deezer(track["title"], track["primary_artist"], track.get("duration_sec"))
            for k, v in dz.items():
                rec.setdefault(k, v)  # Deezer riempie solo i buchi (es. year, bpm)
        except Exception:
            pass
        time.sleep(0.2)
    if rec.get("key") is not None and rec.get("mode"):
        rec["camelot"] = to_camelot(rec["key"], rec["mode"])
    return rec


def load_json(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default=IN_DEFAULT)
    ap.add_argument("--out", dest="out", default=OUT_DEFAULT)
    ap.add_argument("--sources", default="reccobeats,deezer",
                    help="fonti separate da virgola: reccobeats,deezer")
    ap.add_argument("--limit", type=int, default=0, help="processa solo i primi N brani (spike)")
    ap.add_argument("--refresh", action="store_true", help="ignora la cache e riscarica")
    ap.add_argument("--dry-run", action="store_true", help="non riscrive l'archivio (solo cache+report)")
    ap.add_argument("--report", action="store_true", help="stampa le coperture per campo")
    args = ap.parse_args()
    sources = [s.strip() for s in args.sources.split(",") if s.strip()]

    archive = load_json(args.inp, None)
    if archive is None:
        raise SystemExit(f"input non trovato: {args.inp}")
    cache = {} if args.refresh else load_json(CACHE_PATH, {})
    overrides = load_json(OVERRIDES_PATH, {})

    # brani unici da tracks_flat
    uniq = {}
    for t in archive["tracks_flat"]:
        uniq.setdefault(t["spotify_track_id"], t)
    ids = list(uniq.keys())
    if args.limit:
        ids = ids[: args.limit]

    todo = [i for i in ids if args.refresh or i not in cache]
    print(f"brani: {len(ids)} · da scaricare: {len(todo)} · in cache: {len(ids) - len(todo)}")

    # ReccoBeats: pre-scarica tutte le features in pochi batch (evita rate-limit)
    recc = reccobeats_batch(todo) if (todo and "reccobeats" in sources) else {}

    for n, sid in enumerate(todo, 1):
        rec = enrich_one(uniq[sid], sources, recc.get(sid))
        cache[sid] = rec
        if n % 10 == 0 or n == len(todo):
            print(f"  ...{n}/{len(todo)}")
            with open(CACHE_PATH, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False)

    # overrides manuali (vincono sempre) + derivazione camelot
    feats = {}
    for sid in ids:
        rec = dict(cache.get(sid, {}))
        rec.update(overrides.get(sid, {}))
        if rec.get("key") is not None and rec.get("mode") and not rec.get("camelot"):
            rec["camelot"] = to_camelot(rec["key"], rec["mode"])
        feats[sid] = {k: rec[k] for k in AUDIO_FIELDS if rec.get(k) is not None}

    # inietta i campi in OGNI dict-brano dell'archivio (tracks_flat + playlists)
    def inject(track):
        f = feats.get(track.get("spotify_track_id"))
        if f:
            track.update(f)

    if not args.dry_run:
        for t in archive["tracks_flat"]:
            inject(t)
        for pl in archive.get("playlists", []):
            for t in pl.get("tracks", []):
                inject(t)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(archive, f, ensure_ascii=False, indent=2)
        print(f"scritto {args.out}")

    if args.report:
        cov = {k: sum(1 for sid in ids if feats.get(sid, {}).get(k) is not None) for k in AUDIO_FIELDS}
        tot = len(ids)
        print("\nCOPERTURA (su %d brani):" % tot)
        for k in AUDIO_FIELDS:
            print(f"  {k:9s} {cov[k]:4d}/{tot}  ({100*cov[k]//tot if tot else 0}%)")


if __name__ == "__main__":
    main()
