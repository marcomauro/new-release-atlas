# New Release Atlas

Interactive **force-directed map** of my music archive (New Release Playlists).
Each node is a track; edges connect tracks that share an artist, a genre, or a
playlist. Node colour is the **inferred primary genre**; a radial force separates
the genres in space, forming clusters.

Static app: **Vite + React + D3**, with automatic deploy to **GitHub Pages**.
Data is loaded **at runtime** via `fetch` from `graph.json` (not inlined in the
bundle).

Current state: **816 tracks · 7056 edges · 12 genres** (playlists #1–#36 + 1 extra, updated 2026-06-30).

Live: https://marcomauro.github.io/new-release-atlas/

---

## Stack

- **Vite 6** (build, dev server) + **React 18** (no TypeScript)
- **D3 7** for the force-directed simulation and zoom/pan
- **vite-plugin-pwa** (Workbox) for the installable, offline-capable PWA
- **GitHub Actions** for build + deploy to Pages

---

## Local setup

```bash
npm install
python3 scripts/build_graph.py --output public/graph.json
npm run dev
```

`build_graph.py` with no `--input` auto-selects the **richest archive available**
(see [the pipeline](#data-pipeline)), exactly like CI does. Open the URL printed
by Vite (e.g. `http://localhost:5173/new-release-atlas/`).

> **Important:** the map loads `graph.json` via `fetch`, so it only works when
> served by a server (dev server, `npm run preview`, or Pages in production).
> Opening the built file by double-clicking **won't** work, because of the CORS
> policy on local files.

### Production build

```bash
npm run build      # generates dist/
npm run preview    # serves dist/ locally for a realistic check
```

---

## Features

### The map ([`src/MusicNetwork.jsx`](src/MusicNetwork.jsx))

- D3 force-directed graph, one node per track, coloured by **primary genre**;
  a radial force pulls each genre toward its own region, forming clusters.
- **Interactive legend filter** (left), **search**, **zoom / pan / drag**, and a
  **detail panel** on node click (with Spotify link and track metadata).
- Edges are weighted by relationship type and can be **re-weighted live** without
  rebuilding the graph (see [Route weights](#route-weights--mood)).

### Chat → playlist ([`src/Chat.jsx`](src/Chat.jsx) + [`src/playlist.js`](src/playlist.js))

At the bottom of the map there's a chat (**♫ Create a playlist**): describe what
you want to hear and the app builds a playlist by **traversing the graph**,
highlighting the chosen tracks and drawing the listening path that connects them.

**No external AI / no API:** the interpretation is a client-side rule engine
([`src/playlist.js`](src/playlist.js)), so it works offline and is free and
private. It understands (IT/EN):

- **genres** ("jazz", "soulful house", "uk jazz", "neo-soul", "downtempo", …)
- **moods** ("relaxing", "energetic for the party", "focus", "groovy")
- **seed artist / track** with a cue: "like Moodymann", "similar to Louie Vega"
  (it also searches titles, e.g. remixes)
- **number of tracks** ("12 tracks", "a dozen", "long")

Examples: `relaxing jazz, 15 tracks` · `soulful house for the party` ·
`like Moodymann` · `mix neo-soul and uk jazz for the evening` · `surprise me`.

How the playlist is built:

- with a **seed**: it starts from the track and grows by affinity along the
  strongest links (shared artist, shared genre), optionally filtered by genre;
- by **genre/mood**: it selects by genre match + centrality (hub nodes), with
  artist diversity and balancing across the requested genres;
- the final order is a "nearest-neighbour" path over the links, for a smooth listen.

Click a track in the list to isolate it on the graph. You can also **click any
node** on the map and hit **Generate playlist** in its detail panel: this seeds a
playlist from that track and grows it along the graph connections.

### Route weights & mood ([`src/WeightControls.jsx`](src/WeightControls.jsx))

Sliders (shared between the track panel and the chat) let you steer how the
playlist path is grown, without rebuilding the graph:

- **Route weights** — relative pull of each link type:
  Primary genre · Artist · Secondary genre · Same playlist.
  Defaults (the layout's original hierarchy): `artist 3.0 · primary 1.2 ·
  secondary 0.6 · playlist 0.3`.
- **Variety (random)** — injects controlled randomness into the traversal.
- **Mood** — an *influence* slider plus per-axis targets
  (energy / valence / danceability / acousticness / instrumentalness, 0–1) that
  bias selection toward tracks matching the desired feel. Mood values come from
  the enriched archive's `mood_parameters` (see [the pipeline](#data-pipeline)).

### Playback — mini-player ([`src/PlayerBar.jsx`](src/PlayerBar.jsx) + [`src/spotifyConnect.js`](src/spotifyConnect.js))

A persistent mini-player follows the generated **route** and works in two modes:

- **Connect mode** (Spotify Premium): the app acts as a **remote control** for
  your Spotify device via the Web API, playing **full tracks** in sequence (also
  on mobile). Login is **OAuth Authorization Code + PKCE, 100% client-side** — no
  secret in the bundle. A device selector (“Play on …”) lets you pick the target.
- **Embed mode** (not logged in): the official Spotify embed plays a **~30s
  preview** and auto-advances along the route, with an opt-in
  **“Listen full · Spotify Premium”** button to switch to Connect mode.

> Connect mode needs the deployment's **redirect URI** to be registered in the
> Spotify app dashboard. The redirect is computed as
> `window.location.origin + import.meta.env.BASE_URL` (so it follows `base`).
> The client id lives in [`src/spotifyConnect.js`](src/spotifyConnect.js).

### Export to Spotify ([`src/export.js`](src/export.js))

Every generated playlist has an **↗ Export** button: no login, no configuration.
We export the **exact Spotify links** of the tracks (we already have them in the
graph, so the match is precise) and hand them to an external tool:

- on click the links are **copied to the clipboard** and downloaded as **CSV**,
  and **[Spotlistr](https://www.spotlistr.com/search)** opens in a new tab;
- paste the list into Spotlistr → Spotify login → it creates the playlist;
- alternatively: paste the links into a **Spotify desktop** playlist, or import
  the CSV/TXT with **[Soundiiz](https://soundiiz.com/tutorial/import-text-to-spotify)**.

### Install as an app (PWA)

The app is a **Progressive Web App**: installable on desktop and mobile, working
**offline** after the first visit.

- **Desktop (Chrome/Edge):** the "Install" icon in the address bar, or menu ⋮ →
  *Install New Release Atlas*.
- **iOS (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu ⋮ → *Install app*.

Technical details (via [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/),
configured in [`vite.config.js`](vite.config.js)):

- A generated **manifest** with `scope`/`start_url` under the `base`
  `/new-release-atlas/`, `display: standalone`, theme `#2b2724`.
- A **service worker** (Workbox, `registerType: 'autoUpdate'`) that precaches the
  app shell **and `graph.json`** → the map is available offline. It updates itself
  on every new deploy. Google Fonts are cached at runtime (cache-first).
- **Icons** in `public/`: `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`,
  `apple-touch-icon-180.png` and `favicon.svg`.

> Installing requires **HTTPS** (or `localhost`). In `npm run dev` the service
> worker is disabled by default.

---

## Data pipeline

The live map is driven by **one archive**: `data/spotify_archive_enriched.json`
(the AI-enriched archive — genres, subgenres, mood, `mood_parameters`, bpm).
Everything else that used to feed the map (the classic genre/audio enrichment
pipeline) is **frozen in [`legacy/`](legacy/README.md)** and is not part of the
flow anymore. All committed scripts are stdlib-only and fully offline.

```
 PHASE A — data prep (outside the repo · you + AI)
 ──────────────────────────────────────────────────
 support.json   raw tracklist of the new playlist(s)
 char.json      expert characterization of the NEW tracks only

 PHASE B — merge & publish (in the repo · automated)
 ──────────────────────────────────────────────────
 scripts/add_playlist.py         validates + merges into the enriched archive
        │                        (reuse of existing characterizations, duplicate
        ▼                        detection, metadata update, .bak backup)
 data/spotify_archive_enriched.json     the single source of truth
        │
        ▼  scripts/build_graph.py       idempotent, stdlib only — nodes + edges + clusters
 public/graph.json                      the map's input, served statically
```

The full step-by-step (input formats, decision checkpoints, validation rules) is
in [`docs/ADDING_PLAYLISTS.md`](docs/ADDING_PLAYLISTS.md).

### Which archive does `build_graph.py` use?

When run **without `--input`** (the default, and what CI does) it auto-selects the
**first existing** file in this order:

1. `data/spotify_archive_enriched.json` ← **the live source** (#1–#36 + extra)
2. `legacy/data/spotify_archive_features.json` (frozen fallback, #12–#32)
3. `legacy/data/spotify_archive_genres.json` (frozen fallback, #12–#32)

Pass `--input <file>` to force a specific archive. The build degrades gracefully:
node fields that aren't present in the chosen archive (audio, mood, subgenres…)
are simply omitted.

### The archive

**`data/spotify_archive_enriched.json`** holds `metadata` (counts, playlist
range, duplicate notes), `playlists[]` (archival, per-playlist tracklists) and
`tracks_flat[]` (one entry per occurrence — what `build_graph.py` actually
reads). Every track carries the full enrichment: `genres`/`genre_primary`
(12-value taxonomy), `subgenres`, `mood` descriptors, numeric `mood_parameters`
(energy/valence/danceability/acousticness/instrumentalness, 0–1) and
`bpm`/`bpm_source`. The historical RAW/genres/features archives live in
[`legacy/data/`](legacy/README.md), frozen at #12–#32.

### The scripts

- **`scripts/add_playlist.py`** — automated Phase B: takes `support.json` (+
  `char.json`), validates, merges into the enriched archive with backup, updates
  `metadata`, annotates duplicates, and optionally rebuilds the graph (`--build`).
  Stops with a to-do report if any new track lacks a characterization.
- **`scripts/build_graph.py`** — builds `public/graph.json`. Idempotent: it
  regenerates the whole graph from the archive's current state.
- **`scripts/check_docs.py`** — CI guard: fails the build if this README's
  "Current state" line drifts from the freshly regenerated `graph.json`.
- The classic enrichment scripts (`enrich_genres.py`, `enrich_audio.py`,
  `genre_map.py`) are archived in [`legacy/scripts/`](legacy/README.md).

### `graph.json` schema

```jsonc
{
  "nodes": [{
    "id", "title", "artist", "artists", "url", "duration", "duration_sec",
    "genres", "genre", "community",          // community = cluster index (genre by frequency)
    "playlists", "degree",
    "era", "era_norm", "genre_count", "bridging", "artist_track_count",
    // present only when true/available (soft degradation):
    "is_bridge?", "is_remix?", "remixer?", "is_instrumental?", "is_live?", "is_interlude?",
    "mood?", "subgenres?", "bpm_source?",
    "bpm?", "key?", "mode?", "camelot?",
    "energy?", "valence?", "danceability?", "acousticness?", "instrumentalness?",
    "year?", "popularity?"
  }],
  "links": [{ "source", "target", "weight", "c": [artist, primary, secondary, playlist] }],
  "genres": ["...ordered by frequency = cluster index..."],
  "meta": { "unique_tracks", "edges", "genres", "playlists", "playlist_range", "updated", "linkWeights" }
}
```

### How the edges are built

Each edge keeps its components separately in `c = [artist, primary, secondary,
playlist]`, so the front-end can re-weight on the fly. The default weights
(`meta.linkWeights`, used for the layout and as the initial slider values):

- **shared artist** → strong link (`3.0`)
- **shared primary genre** → medium link, sparse kNN (`1.2`)
- **shared secondary genre** → light link (`0.6`)
- **same playlist** → weak link, sliding window (`0.3`)

---

## Weekly workflow

When a new New Release Playlist arrives:

**Phase A — prepare the two inputs** (formats in
[`docs/ADDING_PLAYLISTS.md`](docs/ADDING_PLAYLISTS.md)):

1. `support.json` — the raw tracklist (playlist number/id + per-track
   pos/id/title/artists/duration).
2. `char.json` — the expert characterization of the **new** tracks only
   (genres in the 12-taxonomy, subgenres, mood descriptors, `p` = 5 mood
   parameters 0–1, optional bpm). Tracks already in the archive are reused
   automatically — don't re-characterize them.

**Phase B — merge & publish** (automated):

```bash
# 1. Validate + merge into the enriched archive (writes a .bak first)
#    and regenerate public/graph.json:
python3 scripts/add_playlist.py --support support.json --char char.json --build

#    Tip: run with --dry-run first to preview the merge report.
#    If any new track has no characterization, the script STOPS and prints
#    the exact to-do list of ids to characterize.

# 2. Verify + publish
npm run build
git add data/spotify_archive_enriched.json public/graph.json
git commit -m "data+graph: add playlist #NN" && git push
# → GitHub Actions regenerates the graph, checks docs, rebuilds, republishes
```

### Decision checkpoints

- **Cross-playlist duplicate** (same id in 2+ playlists) → handled automatically:
  1 unique track, N occurrences, annotated in `metadata`.
- **False duplicate** (same title, different id = another recording/edit) →
  the script keeps them separate and prints a WARN so you can double-check.
- **New `genre_primary` outside the 12-taxonomy** → the script warns: adopting a
  new genre also means adding a colour + label in
  [`src/MusicNetwork.jsx`](src/MusicNetwork.jsx) (`GENRE_COLOR`, `GENRE_LABEL`)
  and label/synonyms in [`src/playlist.js`](src/playlist.js).

### Genre taxonomy

```
soulful-house · broken-beat · uk-jazz · jazz · neo-soul · soul-funk
hip-hop · electronic · downtempo · world · alt · classical
```

The taxonomy is defined by the archive itself (the set of `genre_primary`
values) plus the colour/label maps in the front-end. The historical
artist→genres map that generated it lives in `legacy/scripts/genre_map.py`.

---

## Deploy to GitHub Pages

Deploy is automatic: on every push to `main`, the workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. checks out the repo;
2. installs Python and regenerates `public/graph.json` with `build_graph.py`
   (no `--input` → picks the enriched archive), then runs `check_docs.py`
   (fails the build if this README drifted from the data);
3. installs Node, runs `npm ci` and `npm run build`;
4. publishes `dist/` to Pages.

### Note on `base` (critical)

GitHub Pages serves project sites from `/<repo-name>/`. In
[`vite.config.js`](vite.config.js) the `base` field **must** equal the exact
repository name:

```js
base: '/new-release-atlas/',
```

If the repo is renamed, update `base` accordingly — otherwise the assets won't be
found in production and the page stays blank. The component reads `graph.json` via
`import.meta.env.BASE_URL`, and the PWA manifest/scope and Spotify redirect URI all
derive from `base`.

---

## Project structure

```
new-release-atlas/
├── .github/workflows/deploy.yml         # automatic deploy to GitHub Pages
├── data/
│   └── spotify_archive_enriched.json    # THE live source (AI-enriched, #1–#36 + extra)
├── public/
│   └── graph.json                       # GENERATED by build_graph.py
├── scripts/
│   ├── add_playlist.py                  # automated merge of new playlists (Phase B)
│   ├── build_graph.py                   # builds graph.json
│   └── check_docs.py                    # CI guard: README ↔ graph.json
├── docs/
│   └── ADDING_PLAYLISTS.md              # step-by-step: adding playlists to the map
├── legacy/                              # frozen: classic pipeline + historical artifacts
│   ├── README.md                        # what's here and why
│   ├── scripts/                         # enrich_genres.py · enrich_audio.py · genre_map.py
│   ├── data/                            # RAW/genres/features archives (#12–#32) + overrides
│   └── docs/                            # prompt.md · CLAUDE_CODE_BRIEFING.md (bootstrap records)
├── src/
│   ├── MusicNetwork.jsx                 # the map component (D3 force graph)
│   ├── Chat.jsx                         # chat panel (prompt → playlist)
│   ├── playlist.js                      # rule engine: prompt → playlist
│   ├── WeightControls.jsx               # route-weight / variety / mood sliders
│   ├── PlayerBar.jsx                    # mini-player (Spotify Connect + embed)
│   ├── spotifyConnect.js                # OAuth PKCE + Spotify Web API (client-side)
│   ├── export.js                        # export links/CSV → Spotlistr/Spotify
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

> **Historical note:** the project's bootstrap artifacts (`prompt.md`, the
> original scaffolding prompt, and `CLAUDE_CODE_BRIEFING.md`) are archived in
> [`legacy/docs/`](legacy/README.md) together with the frozen classic pipeline.
> This README describes the current flow and remains the source of truth.
