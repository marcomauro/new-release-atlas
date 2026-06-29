# New Release Atlas

Interactive **force-directed map** of my music archive (New Release Playlists).
Each node is a track; edges connect tracks that share an artist, a genre, or a
playlist. Node colour is the **inferred primary genre**; a radial force separates
the genres in space, forming clusters.

Static app: **Vite + React + D3**, with automatic deploy to **GitHub Pages**.
Data is loaded **at runtime** via `fetch` from `graph.json` (not inlined in the
bundle).

Current state: **816 tracks · 7056 edges · 12 genres** (New Release Playlists #1–#36 + 1 extra compilation, updated 2026-06-30).

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

The archive goes through several stages before becoming the map. **None of the
committed Python scripts use the Spotify API at runtime, and only `enrich_audio.py`
needs internet.** `build_graph.py` reads whatever archive is present, fully offline.

```
data/spotify_archive.json              RAW archive (tracks, artists, playlists) — source of truth, hand-maintained
        │
        ▼  scripts/enrich_genres.py     (uses scripts/genre_map.py) — adds genres + genre_primary
data/spotify_archive_genres.json
        │
        ▼  scripts/enrich_audio.py      LOCAL, needs internet — adds bpm/key/mode/camelot/energy/valence/year/popularity/isrc
data/spotify_archive_features.json

data/spotify_archive_enriched.json      AI-expert enrichment — subgenres, mood, mood_parameters (0–1), bpm/bpm_source
        │
        ▼  scripts/build_graph.py       idempotent, stdlib only — builds nodes + edges + clusters
public/graph.json                       the map's input, served statically
```

### Which archive does `build_graph.py` use?

When run **without `--input`** (the default, and what CI does) it auto-selects the
**first existing** file in this order — richest first:

1. `data/spotify_archive_enriched.json` ← currently the live source (#1–#36)
2. `data/spotify_archive_features.json`
3. `data/spotify_archive_genres.json`

Pass `--input <file>` to force a specific archive. The build degrades gracefully:
node fields that aren't present in the chosen archive (audio, mood, subgenres…)
are simply omitted.

### The archives

- **`spotify_archive.json`** — RAW, hand-maintained source of truth. New playlists
  are appended here.
- **`spotify_archive_genres.json`** — output of `enrich_genres.py`: every track
  gets `genres` + `genre_primary`.
- **`spotify_archive_features.json`** — output of `enrich_audio.py`: web-sourced
  audio data. Coverage is high for `year`/`popularity`/`isrc` (≈97%) and low for
  ReccoBeats audio features like `bpm`/`energy` (≈6%), so it's complementary to:
- **`spotify_archive_enriched.json`** — produced by an **AI-expert enrichment
  pass** (not a committed script; its schema is documented in the file's
  `metadata`). Adds granular `subgenres`, `mood` descriptors, numeric
  `mood_parameters` (energy/valence/danceability/acousticness/instrumentalness,
  0–1) and `bpm`/`bpm_source`. This is what drives the map's mood features today.

### The supporting scripts

- **`scripts/genre_map.py`** — artist→genres map (≈541 artists) + helper functions.
  A **dependency** of `enrich_genres.py`: they must live in the same `scripts/` folder.
- **`scripts/enrich_genres.py`** — classifies each track by genre.
- **`scripts/enrich_audio.py`** — fetches audio data from **ReccoBeats** (audio
  features by Spotify ID), **Spotify** (track object: year/popularity/isrc — needs
  `SPOTIFY_CLIENT_ID`/`SPOTIFY_CLIENT_SECRET` in env, skipped otherwise) and
  **Deezer** (gap-fill by duration match). Idempotent with an on-disk cache
  (`data/.audio_cache.json`, gitignored). Run locally; the result is committed and
  **`enrich_audio.py` never runs in CI**.
- **`scripts/build_graph.py`** — builds the graph. Idempotent: it regenerates the
  whole graph from the archive's current state.

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

## Stato dati / TODO

> ⚠️ **Disallineamento dei sorgenti dati.** Il grafo live (`public/graph.json`) è
> a **#1–#36 · 796 tracks · 6862 edges · 12 genres**, generato dall'archivio
> AI-arricchito `data/spotify_archive_enriched.json` (#1–#36, 36 playlist, 816
> tracce flat). I sorgenti della pipeline *classica* sono invece fermi a **#12–#32
> · 471 tracks · 21 playlist**:
>
> - `data/spotify_archive.json` (RAW, fonte di verità a monte)
> - `data/spotify_archive_genres.json`
> - `data/spotify_archive_features.json`
>
> **TODO:** rigenerare/ricommittare questi tre file dalla pipeline reale che
> alimenta il grafo (#1–#36, con mood/bpm), così che la sorgente a monte torni
> allineata al grafo pubblicato. Finché non avviene, l'unica sorgente aggiornata è
> `spotify_archive_enriched.json`. *(I file dati non vanno modificati a mano: vanno
> prodotti dalla pipeline.)*

---

## Weekly workflow

> **Adding playlists to the live map → see [`docs/ADDING_PLAYLISTS.md`](docs/ADDING_PLAYLISTS.md).**
> The map is driven by the AI-enriched archive (`spotify_archive_enriched.json`), so
> that doc is the current step-by-step. The pipeline below is the **classic
> genre/audio enrichment** that produces the *fallback* archives.

When a new New Release Playlist arrives:

```bash
# 1. Update the RAW archive with the new tracks (data/spotify_archive.json),
#    exporting from your curation system.

# 2. Enrich with genres
python3 scripts/enrich_genres.py \
    --input data/spotify_archive.json \
    --output data/spotify_archive_genres.json \
    --overrides data/genre_overrides.json \
    --report-missing data/missing_artists.json

# 3. If the script reports unclassified artists, add them to
#    data/genre_overrides.json and re-run step 2 (see below).

# 4. (optional) Refresh audio data — local, needs internet:
python3 scripts/enrich_audio.py --report
#    Set SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET in env to include
#    year/popularity/isrc from Spotify.

# 5. Regenerate the graph (auto-picks the richest archive available)
python3 scripts/build_graph.py --output public/graph.json

# 6. Commit + push → GitHub Actions republishes by itself
git add -A && git commit -m "update: New Release #NN" && git push
```

> CI regenerates `graph.json` from the richest committed archive on every push, so
> even if you forget step 5 the published site stays consistent. The AI-enriched
> `spotify_archive_enriched.json` is maintained separately and committed when refreshed.

### Handling new / unknown artists

`enrich_genres.py` classifies artists via `genre_map.py`. For unknown artists it
attempts **context inference**: an artist that collaborates on a track with known
artists inherits their genres (reduced weight). It stays `unknown` only with no
anchor at all, and is **reported** at the end of the run.

Two ways to classify a new artist:

- **quick** — add it to `data/genre_overrides.json` (no code change):

  ```json
  { "Artist Name": ["genre1", "genre2"], "Another Artist": ["jazz"] }
  ```

- **permanent** — add it to the `GENRES` dictionary in `scripts/genre_map.py`.

Useful `enrich_genres.py` options:

- `--report-missing data/missing_artists.json` — for each `unknown` artist, writes
  track count and known collaborators: useful for classifying it.
- `--fail-on-missing N` — exits with an error if more than `N` remain unclassified
  (handy in CI to be alerted when a playlist introduces new artists).

### Genre taxonomy

```
soulful-house · broken-beat · uk-jazz · jazz · neo-soul · soul-funk
hip-hop · electronic · downtempo · world · alt · classical
```

(`unknown` is the fallback, to be avoided in overrides.)

---

## Deploy to GitHub Pages

Deploy is automatic: on every push to `main`, the workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml):

1. checks out the repo;
2. installs Python and regenerates `public/graph.json` with `build_graph.py`
   (no `--input` → auto-picks the richest archive). `enrich_audio.py` does **not**
   run in CI — its data is committed separately;
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
│   ├── spotify_archive.json             # RAW archive (source of truth)
│   ├── spotify_archive_genres.json      # + genres (enrich_genres.py)
│   ├── spotify_archive_features.json    # + web audio data (enrich_audio.py)
│   ├── spotify_archive_enriched.json    # + AI subgenres/mood/bpm — live source for build_graph
│   └── genre_overrides.json             # (optional, NOT committed) extra artist→genres, created on demand
├── public/
│   └── graph.json                       # GENERATED by build_graph.py
├── scripts/
│   ├── genre_map.py                     # artist→genres map (dependency of enrich_genres)
│   ├── enrich_genres.py                 # genre enrichment
│   ├── enrich_audio.py                  # audio enrichment (local, needs internet)
│   └── build_graph.py                   # builds graph.json
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

> **Historical note:** `prompt.md` is the original scaffolding artifact used to
> bootstrap the project (a smaller two-stage pipeline) and is kept **untouched** as
> a creation record. `CLAUDE_CODE_BRIEFING.md` has since been realigned to the
> current state (counts, pipeline, per-track schema). This README remains the
> source of truth.
