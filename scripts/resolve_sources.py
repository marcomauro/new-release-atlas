#!/usr/bin/env python3
"""
resolve_sources.py — trova ogni brano dell'archivio sulle ALTRE piattaforme.

Prima sorgente supportata: YouTube (player di default del ramo
experimental/platform-independence). La risoluzione gira OFFLINE (in locale o
in CI), mai nel browser: il risultato viene salvato in data/sources.json e
build_graph.py lo fonde in public/graph.json (campo "yt" dei nodi). A runtime
quindi nessuna chiave API, nessuna ricerca, nessun rate limit.

Uso:
    YOUTUBE_API_KEY=... python3 scripts/resolve_sources.py [--limit N]
        [--budget 9000] [--retry-none] [--retry-review] [--refresh]
        [--region IT] [--dry-run]
    python3 scripts/resolve_sources.py --report      # solo report, nessuna rete

Costo YouTube Data API v3: search.list = 100 unità, videos.list e
playlistItems.list = 1 unità -> ~101 unità a brano; la quota di default è
10.000/giorno per progetto. Lo script è INCREMENTALE: salta i brani già
controllati, salva dopo ogni brano e si ferma pulito a budget esaurito o al
primo "quotaExceeded" — basta rilanciarlo il giorno dopo.

Seconda ricerca nei canali "Topic": la ricerca dell'API non restituisce mai
le Art Track ("Artista - Topic", "Provided to YouTube by …"), cioè proprio
l'audio ufficiale della release. Se la prima ricerca non dà un match sicuro,
lo script cerca i canali "Artista - Topic" (100 unità, UNA volta per artista:
gli id restano in data/sources.json -> "youtube_topic") e ne legge i
caricamenti (1 unità ogni 50). In tutto ~75-90 brani al giorno.

Punteggio (score): titolo 0.30 · artista 0.25 · durata 0.30 · canale ufficiale
0.15 ("Topic" o canale dell'artista), meno penalità per versioni diverse e per
cover/432hz/teaser; oltre 30 s di scarto di durata il brano non va mai in
"review". HTTP 429 o 403 di quota fermano il giro come quota esaurita.

Esiti per brano (data/sources.json -> "youtube" -> <track id>):
    matched  punteggio >= MATCH_MIN: finisce nel grafo
    review   punteggio fra REVIEW_MIN e MATCH_MIN: NON finisce nel grafo,
             compare nel report con i candidati da verificare a mano
    none     nessun candidato credibile

Correzioni manuali: data/source_overrides.json vince sempre sul risolutore
(e i brani lì presenti non vengono mai cercati):
    { "youtube": { "<track id>": "<videoId>",      # match forzato
                   "<track id>": null } }          # "non è su YouTube"

La normalizzazione dei titoli (accenti, punteggiatura, "feat.") avviene SOLO
in memoria per il confronto: i campi dell'archivio non vengono mai toccati
(vedi tests/test_unicode_safety.py). Solo stdlib.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

ARCHIVE = "data/spotify_archive_enriched.json"
SOURCES = "data/sources.json"
OVERRIDES = "data/source_overrides.json"

YT_API = "https://www.googleapis.com/youtube/v3"
COST_PER_TRACK = 101          # search.list (100) + videos.list (1), senza seconda ricerca
UNIT_COST = {"search": 100}   # ogni altro endpoint usato costa 1 unità
DEFAULT_BUDGET = 9000         # margine sotto la quota giornaliera di 10.000
MATCH_MIN = 0.70
REVIEW_MIN = 0.50
CANDIDATES = 5
TOPIC_CHANNELS = 6            # omonimi: "Koralle - Topic" ne ha sei
TOPIC_PAGES = 4               # 200 caricamenti per canale

USER_AGENT = "new-release-atlas/resolve_sources (+https://github.com/marcomauro/new-release-atlas)"


class QuotaExceeded(Exception):
    pass


class Meter:
    """Avvolge fetch e conta le unità di quota spese."""

    def __init__(self, fetch):
        self.fetch, self.units = fetch, 0

    def __call__(self, url):
        endpoint = urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1]
        self.units += UNIT_COST.get(endpoint, 1)
        return self.fetch(url)


# --- normalizzazione (solo per il confronto, mai salvata) -----------------
# parole che non distinguono una registrazione da un'altra
_STOP = {
    "official", "video", "audio", "music", "musicvideo", "lyric", "lyrics", "hd", "hq",
    "4k", "visualizer", "visualiser", "feat", "ft", "featuring", "with", "the", "a",
    "and", "version", "original", "mix", "remastered", "remaster", "topic", "full",
    "track", "single", "album", "x", "vs", "e", "di", "il", "la",
}
# differenze di VERSIONE: presenti da un solo lato -> penalità leggera
_VERSION = {"live", "remix", "instrumental", "acoustic", "edit", "extended", "dub",
            "rework", "reprise", "demo", "radio"}
# contenuti che non sono la registrazione: presenti solo su YouTube -> penalità forte
_BAD = {"cover", "karaoke", "reaction", "nightcore", "slowed", "sped", "8d",
        "tutorial", "lesson", "piano", "guitar", "drum", "bass", "loop", "hour",
        "432hz", "528hz", "reverb", "bassboosted", "mashup", "shorts", "teaser", "trailer",
        "interview", "podcast", "snippet"}


def _plain(s):
    """casefold + niente segni diacritici/combinanti + solo alfanumerici."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^\w]+", " ", s.casefold()).strip()


def tokens(s):
    return set(_plain(s).split())


def iso_duration(s):
    """'PT1H2M3S' -> secondi (int) oppure None."""
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", s or "")
    if not m or not any(m.groups()):
        return None
    d, h, mi, se = (int(x) if x else 0 for x in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + se


def duration_score(track_sec, video_sec):
    if not track_sec or not video_sec:
        return 0.5
    diff = abs(track_sec - video_sec)
    if diff <= 2:
        return 1.0
    if diff <= 5:
        return 0.8
    if diff <= 12:
        return 0.5
    if diff <= 30:
        return 0.2
    return 0.0


def official_channel(track, video):
    """1.0 se il video viene dall'audio del distributore ("Artista - Topic",
    "Provided to YouTube by …") o dal canale dell'artista ("Puma Blue",
    "tameimpalaVEVO", "corto. alto"); altrimenti 0.0 (re-upload, canali lyric)."""
    channel = video.get("channel", "")
    if channel.endswith(" - Topic") or (video.get("description") or "").startswith("Provided to YouTube by"):
        return 1.0
    artist = _plain(track.get("primary_artist", "")).replace(" ", "")
    return 1.0 if artist and _plain(channel).replace(" ", "").startswith(artist) else 0.0


def score(track, video):
    """Affinità 0..1 fra un brano dell'archivio e un video candidato.

    track: {title, primary_artist, duration_sec}
    video: {title, channel, description, duration_sec}
    """
    t_title = tokens(track["title"]) - _STOP
    t_artist = tokens(track.get("primary_artist", "")) - _STOP
    v_title = tokens(video.get("title", ""))
    v_chan = tokens(video.get("channel", ""))
    v_all = v_title | v_chan

    title = len(t_title & v_title) / len(t_title) if t_title else 0.5
    artist = len(t_artist & v_all) / len(t_artist) if t_artist else 0.5
    dur = duration_score(track.get("duration_sec"), video.get("duration_sec"))
    # a parità di brano, meglio la fonte ufficiale di un re-upload (che può sparire)
    official = official_channel(track, video)

    # titolo + artista: "Drum Talk" o "Live Garden" non sono una cover/un live
    known = tokens(track["title"]) | tokens(track.get("primary_artist", ""))
    penalty = 0.0
    for w in _VERSION:
        if (w in known) != (w in v_title):
            penalty += 0.12
    for w in _BAD:
        if w in v_title and w not in known:
            penalty += 0.4

    s = 0.30 * title + 0.25 * artist + 0.30 * dur + 0.15 * official - penalty
    # oltre 30 s di scarto non è la stessa registrazione (teaser, intervista,
    # live, altro mix): titolo e artista da soli non bastano nemmeno per "review"
    if dur == 0.0 and track.get("duration_sec") and video.get("duration_sec"):
        s = min(s, REVIEW_MIN - 0.05)
    return round(max(0.0, min(1.0, s)), 3)


# --- YouTube Data API ------------------------------------------------------

def http_get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {}
        errs = (body.get("error") or {}).get("errors") or [{}]
        reason = errs[0].get("reason", "")
        if e.code == 429 or (e.code == 403 and reason in
                             ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded")):
            raise QuotaExceeded(reason or f"HTTP {e.code}")
        raise RuntimeError(f"HTTP {e.code} {reason or e.reason}")


def youtube_candidates(track, key, region=None, fetch=http_get_json):
    """Cerca il brano e restituisce i candidati arricchiti con durata/stato."""
    q = f"{track.get('primary_artist', '')} {track['title']}".strip()
    params = {"part": "snippet", "type": "video", "maxResults": CANDIDATES,
              "videoEmbeddable": "true", "q": q, "key": key}
    if region:
        params["regionCode"] = region
    found = fetch(f"{YT_API}/search?{urllib.parse.urlencode(params)}")
    ids = [it["id"]["videoId"] for it in found.get("items", [])
           if it.get("id", {}).get("videoId")]
    return video_details(ids, key, region, fetch)


def video_details(ids, key, region=None, fetch=http_get_json):
    """videos.list (max 50 id): durata/canale/descrizione, solo video embeddabili."""
    if not ids:
        return []
    params = {"part": "snippet,contentDetails,status", "id": ",".join(ids[:50]), "key": key}
    details = fetch(f"{YT_API}/videos?{urllib.parse.urlencode(params)}")
    out = []
    for it in details.get("items", []):
        st = it.get("status", {})
        if not st.get("embeddable", False) or st.get("privacyStatus") not in (None, "public"):
            continue
        rr = it.get("contentDetails", {}).get("regionRestriction") or {}
        if region and (region in rr.get("blocked", [])
                       or ("allowed" in rr and region not in rr["allowed"])):
            continue
        sn = it.get("snippet", {})
        out.append({
            "id": it["id"],
            "title": sn.get("title", ""),
            "channel": sn.get("channelTitle", ""),
            "description": sn.get("description", ""),
            "duration_sec": iso_duration(it.get("contentDetails", {}).get("duration")),
        })
    return out


def topic_channels(artist, key, fetch=http_get_json, cache=None):
    """Id dei canali "<artista> - Topic" (anche omonimi), cercati una volta per artista."""
    if cache is not None and artist in cache:
        return cache[artist]
    params = {"part": "snippet", "type": "channel", "maxResults": 10, "q": artist, "key": key}
    found = fetch(f"{YT_API}/search?{urllib.parse.urlencode(params)}")
    ids = []
    for it in found.get("items", []):
        name = it.get("snippet", {}).get("channelTitle", "")
        cid = it.get("id", {}).get("channelId")
        if cid and name.endswith(" - Topic") and _plain(name[:-len(" - Topic")]) == _plain(artist):
            ids.append(cid)
    ids = ids[:TOPIC_CHANNELS]
    if cache is not None:
        cache[artist] = ids
    return ids


def topic_candidates(track, key, region=None, fetch=http_get_json, cache=None):
    """Art Track dai caricamenti dei canali Topic dell'artista con un titolo simile."""
    artist = track.get("primary_artist", "")
    t_title = tokens(track["title"]) - _STOP
    if not artist or not t_title:
        return []
    hits = []
    for cid in topic_channels(artist, key, fetch, cache):
        params = {"part": "snippet", "maxResults": 50, "playlistId": "UU" + cid[2:], "key": key}
        for _ in range(TOPIC_PAGES):
            try:
                page = fetch(f"{YT_API}/playlistItems?{urllib.parse.urlencode(params)}")
            except RuntimeError:          # canale senza caricamenti pubblici
                break
            for it in page.get("items", []):
                sn = it.get("snippet", {})
                vid = sn.get("resourceId", {}).get("videoId")
                overlap = len(t_title & tokens(sn.get("title", ""))) / len(t_title)
                if vid and overlap >= 0.5 and vid not in (h[1] for h in hits):
                    hits.append((overlap, vid))
            if not page.get("nextPageToken"):
                break
            params["pageToken"] = page["nextPageToken"]
        params.pop("pageToken", None)
    hits.sort(key=lambda h: -h[0])
    return video_details([vid for _, vid in hits], key, region, fetch)


def resolve_one(track, key, region=None, fetch=http_get_json, today=None, topic_cache=None):
    """Esito per un brano: {id?, status, score?, title?, channel?, alt?, checked}.

    Senza un match sicuro dalla ricerca, prova i canali Topic dell'artista
    (topic_cache: {artista: [channelId]}, condivisa fra i brani)."""
    cands = youtube_candidates(track, key, region, fetch)
    ranked = sorted(((score(track, c), c) for c in cands), key=lambda x: -x[0])
    if not ranked or ranked[0][0] < MATCH_MIN:
        seen = {c["id"] for c in cands}
        more = [c for c in topic_candidates(track, key, region, fetch, topic_cache) if c["id"] not in seen]
        ranked = sorted(ranked + [(score(track, c), c) for c in more], key=lambda x: -x[0])
    entry = {"checked": today or date.today().isoformat()}
    if not ranked or ranked[0][0] < REVIEW_MIN:
        entry["status"] = "none"
        return entry
    best_s, best = ranked[0]
    entry.update({
        "status": "matched" if best_s >= MATCH_MIN else "review",
        "id": best["id"], "score": best_s,
        "title": best["title"], "channel": best["channel"],
    })
    if entry["status"] == "review":
        entry["alt"] = [[c["id"], s] for s, c in ranked[1:3]]
    return entry


# --- archivio / file -------------------------------------------------------

def unique_tracks(archive):
    """Un brano per id, nell'ordine di prima apparizione (= cronologico)."""
    seen = {}
    for t in archive["tracks_flat"]:
        tid = t["spotify_track_id"]
        if tid not in seen:
            seen[tid] = {"id": tid, "title": t["title"],
                         "primary_artist": t.get("primary_artist") or (t.get("artists") or [""])[0],
                         "duration_sec": t.get("duration_sec")}
    return list(seen.values())


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    """Scrittura atomica: un'interruzione non lascia mai un file a metà."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def todo(tracks, cache, overrides, retry_none=False, refresh=False, retry_review=False):
    retry = {s for s, on in (("none", retry_none), ("review", retry_review)) if on}
    out = []
    for t in tracks:
        if t["id"] in overrides:
            continue
        e = cache.get(t["id"])
        if refresh or e is None or e.get("status") in retry:
            out.append(t)
    return out


def report(tracks, cache, overrides):
    counts = {"matched": 0, "review": 0, "none": 0, "override": 0, "pending": 0}
    review = []
    for t in tracks:
        if t["id"] in overrides:
            counts["override"] += 1
            continue
        e = cache.get(t["id"])
        if e is None:
            counts["pending"] += 1
            continue
        counts[e["status"]] += 1
        if e["status"] == "review":
            review.append((t, e))
    n = len(tracks)
    playable = counts["matched"] + sum(1 for v in overrides.values() if v)
    print(f"YouTube · {n} brani: {counts['matched']} matched · {counts['review']} review · "
          f"{counts['none']} none · {counts['override']} override · {counts['pending']} da cercare")
    print(f"         riproducibili: {playable}/{n} ({100 * playable / max(1, n):.0f}%)")
    if review:
        print("\nDa verificare (aggiungi a data/source_overrides.json il videoId giusto, o null):")
        for t, e in review:
            print(f"  {t['id']}  {t['primary_artist']} — {t['title']}")
            print(f"      {e['score']:.2f}  https://youtu.be/{e['id']}  [{e['channel']}] {e['title']}")
            for vid, s in e.get("alt", []):
                print(f"      {s:.2f}  https://youtu.be/{vid}")
    return counts


def main():
    ap = argparse.ArgumentParser(description="Risolve i brani dell'archivio su YouTube.")
    ap.add_argument("--archive", default=ARCHIVE)
    ap.add_argument("--sources", default=SOURCES)
    ap.add_argument("--overrides", default=OVERRIDES)
    ap.add_argument("--key", default=os.environ.get("YOUTUBE_API_KEY"),
                    help="chiave YouTube Data API v3 (default: $YOUTUBE_API_KEY)")
    ap.add_argument("--limit", type=int, default=None, help="massimo brani da cercare in questo giro")
    ap.add_argument("--budget", type=int, default=DEFAULT_BUDGET, help="unità di quota da non superare")
    ap.add_argument("--region", default=None, help="es. IT: scarta i video bloccati in quel paese")
    ap.add_argument("--retry-none", action="store_true", help="ricerca di nuovo i brani 'none'")
    ap.add_argument("--retry-review", action="store_true", help="ricerca di nuovo i brani 'review'")
    ap.add_argument("--refresh", action="store_true", help="ricerca di nuovo TUTTI i brani")
    ap.add_argument("--dry-run", action="store_true", help="cerca ma non scrive")
    ap.add_argument("--report", action="store_true", help="solo report dello stato attuale")
    args = ap.parse_args()

    archive = load_json(args.archive, None)
    if archive is None:
        sys.exit(f"ERRORE: archivio non trovato: {args.archive}")
    sources = load_json(args.sources, {"version": 1})
    cache = sources.setdefault("youtube", {})
    topic_cache = sources.setdefault("youtube_topic", {})
    overrides = load_json(args.overrides, {}).get("youtube", {})
    tracks = unique_tracks(archive)

    if args.report:
        report(tracks, cache, overrides)
        return
    if not args.key:
        sys.exit("ERRORE: serve una chiave YouTube Data API v3 (--key o $YOUTUBE_API_KEY).")

    queue = todo(tracks, cache, overrides, args.retry_none, args.refresh, args.retry_review)
    if args.limit is not None:
        queue = queue[:args.limit]
    print(f"{len(queue)} brani da cercare · budget {args.budget} unità "
          f"(~{COST_PER_TRACK} a brano, ~200 con la seconda ricerca Topic)")

    meter = Meter(http_get_json)
    done = 0
    try:
        for t in queue:
            # il margine sotto la quota giornaliera assorbe l'ultimo brano
            if meter.units + COST_PER_TRACK > args.budget:
                print(f"\nBudget raggiunto ({meter.units} unità): rilancia domani.")
                break
            try:
                entry = resolve_one(t, args.key, args.region, fetch=meter, topic_cache=topic_cache)
            except RuntimeError as e:
                print(f"  SKIP  {t['id']}  {e}")
                continue
            cache[t["id"]] = entry
            done += 1
            mark = {"matched": "✓", "review": "?", "none": "·"}[entry["status"]]
            print(f"  {mark} {entry.get('score', 0):.2f}  {t['primary_artist']} — {t['title']}")
            if not args.dry_run:
                save_json(args.sources, sources)
    except QuotaExceeded as e:
        print(f"\nQuota YouTube esaurita ({e}): progressi salvati, rilancia domani.")
    except KeyboardInterrupt:
        print("\nInterrotto: progressi salvati.")
    if not args.dry_run:
        save_json(args.sources, sources)   # anche i canali Topic trovati prima dello stop
    print(f"\n{done} brani risolti in questo giro · {meter.units} unità di quota.\n")
    report(tracks, cache, overrides)


if __name__ == "__main__":
    main()
