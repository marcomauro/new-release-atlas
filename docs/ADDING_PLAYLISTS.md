# Adding new playlists to Atlas

Step-by-step procedure to add one or more **New Release** playlists to the map,
based on the project's *actual* pipeline.

---

## The one fact that drives everything

The live map reads **only** `data/spotify_archive_enriched.json`.

`build_graph.py` auto-selects the **richest** archive available, and `enriched`
is first in that order — so it always wins. Therefore:

> **Adding playlists = extending `spotify_archive_enriched.json`.**

The "classic" pipeline in the README (`enrich_genres.py` → `enrich_audio.py`)
produces the *fallback* archives (`spotify_archive(.json|_genres|_features)`).
Those are currently **frozen at #12–#32 and are NOT used by the live map.**
Keeping them in sync is optional (archive tidiness only).

| Archive | Content | Role |
|---|---|---|
| `spotify_archive.json` · `_genres` · `_features` | #12–#32 (frozen) | legacy / fallback — **not** the live source |
| **`spotify_archive_enriched.json`** | #1–#34 | **live source** (what `build_graph` picks) |

---

## Flow

```
 PHASE A — DATA PREP (outside the repo · you + AI)     PHASE B — MERGE & PUBLISH (in the repo · AI/CLI)
 ─────────────────────────────────────────────────    ────────────────────────────────────────────────
 1. support.json   (raw tracklist)                     4. merge → spotify_archive_enriched.json
    pl/pos/id/title/artists/dur + playlist_id              + validate (counts, enrichment, duplicates)
 2. char.json      (expert characterization)           5. python3 scripts/build_graph.py → public/graph.json
    NEW tracks only, keyed by spotify_track_id         6. npm run build → commit → push
 3. tracks already in the archive → REUSE existing        → GitHub Actions republishes
    characterization (don't redo them)
                                                       ▼  https://marcomauro.github.io/new-release-atlas/
```

---

## Phase A — Data prep (the two inputs)

### 1. `support.json` — the raw tracklist

One entry per **occurrence** (a track in a given playlist position):

```jsonc
{
  "playlist_ids": { "35": "<spotify_playlist_id>", ... },   // number → Spotify playlist id
  "tracks": [
    { "pl": 35, "pos": 1, "id": "<spotify_track_id>",
      "title": "...", "artists": ["...", "..."], "dur": "m:ss" }
  ]
}
```

(The `atlas_support_minimal` / `provisional` files used for #1–#11 are exactly
this — a structured `playlists[]` variant is fine too, as long as the same fields
are present.)

### 2. `char.json` — expert characterization (NEW tracks only)

A dict keyed by `spotify_track_id`. Provide it **only for tracks not already in
the enriched archive**:

```jsonc
{
  "<spotify_track_id>": {
    "G":   ["primary-genre", "secondary-genre"],  // 12-taxonomy; G[0] = genre_primary
    "g":   "Expert Macro",                          // expert macro-genre (House, Jazz, R&B…)
    "sg":  ["subgenre1", "subgenre2", "subgenre3"],
    "m":   ["mood1", "mood2", "mood3"],
    "p":   [energy, valence, danceability, acousticness, instrumentalness], // 0–1
    "bpm": 122,            // optional (omit → null)
    "src": "estimated"     // optional (omit → "estimated")
  }
}
```

### 3. Reuse, don't re-characterize

A track id that **already exists** in `spotify_archive_enriched.json` (it
reappears in a later playlist, or is a cross-playlist duplicate) **reuses the
characterization already in the archive** — leave it out of `char.json`.

---

## Phase B — Merge & publish (in the repo)

### 4. Merge into `spotify_archive_enriched.json`

For each occurrence, build a full master-schema track:

- `duration_sec` from `dur` (mm:ss), `spotify_uri = spotify:track:{id}`,
  `spotify_url = https://open.spotify.com/track/{id}`,
  `playlist_name = "New Release Friday #N"`, `playlist_id`, `position_in_playlist`.
- Enrichment from `char[id]`: `genres = G`, `genre_primary = G[0]`,
  `subgenres = sg` (with the lowercased macro `g` prepended if absent),
  `mood = m`, `mood_parameters` from `p`, `bpm`/`bpm_source` (defaults: `null` /
  `"estimated"`). For reused ids, copy the enrichment from the existing entry.
- Append the playlist to `playlists[]` and the occurrences to `tracks_flat`.
- Update `metadata`: `playlist_range`, `total_tracks_with_duplicates`,
  `unique_tracks`, `unique_artists`, `top_artists`, plus duplicate / false-duplicate
  notes. **Do not modify the characterization of existing playlists.**

> Always write a `.bak` of the enriched archive before overwriting.

### 5. Regenerate the map

```bash
python3 scripts/build_graph.py        # no --input → auto-picks the enriched archive
```

→ rewrites `public/graph.json`.

### 6. Build, commit, deploy

```bash
npm run build
git add data/spotify_archive_enriched.json public/graph.json   # + front-end iff a new genre was added
git commit -m "data+graph: add playlist #NN"
git push                              # GitHub Actions rebuilds graph.json and republishes
```

---

## Decision checkpoints (during step 4)

- **Cross-playlist duplicate** (same id in 2+ playlists) → 1 unique track, N
  occurrences; note it in `metadata`.
- **False duplicate** (same title, **different id** = another recording/edit) →
  keep them as separate tracks.
- **New `genre_primary` outside the 12-taxonomy** (as `downtempo` was) → your call:
  remap it to an existing macro, **or** adopt it as a new genre — which also means
  adding a colour + label in [`src/MusicNetwork.jsx`](../src/MusicNetwork.jsx)
  (`GENRE_COLOR`, `GENRE_LABEL`) and a label/synonyms in
  [`src/playlist.js`](../src/playlist.js).

## Validation (must pass before commit)

- `playlists == old + new`, `occurrences == old + new`, `unique_tracks` consistent.
- **Every** `tracks_flat` entry has the full enrichment (`genres`, `genre_primary`,
  `subgenres`, `mood`, `mood_parameters` with 5 keys, `bpm`/`bpm_source`).
- Every new id (except reused ones) has a `char` entry — otherwise **stop**.
- Pre-existing playlists are **byte-identical** to before.

---

## TL;DR — what to hand Claude

Just the **two Phase-A files** (`support.json` + `char.json`). Claude does Phase B
(merge, validation, graph regeneration, build, PR) — exactly as done for #1–#11.

> **Legacy pipeline note:** the RAW/genres/features archives are frozen at #12–#32
> and do not feed the map. Re-syncing them is optional. Re-generating the enriched
> archive *from a script* (instead of the AI-expert pass) would be a separate
> project to design.
