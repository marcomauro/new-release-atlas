# New Release Atlas

Interactive **force-directed map** of my music archive (New Release Playlists).
Each node is a track; edges connect tracks that share an artist, a genre, or a
playlist. Node colour is the **inferred primary genre**; a radial force separates
the genres in space, forming clusters.

Static app: **Vite + React + D3**, with automatic deploy to **GitHub Pages**.
Data is loaded **at runtime** via `fetch` from `graph.json` (not inlined in the
bundle).

Current state: **468 tracks · 3391 edges · 12 genres** (playlists #12–#32).

Live: https://marcomauro.github.io/new-release-atlas/

---

## Stack

- **Vite** (build, dev server) + **React 18** (no TypeScript)
- **D3** for the force-directed simulation and zoom/pan
- **GitHub Actions** for build + deploy to Pages

---

## Local setup

```bash
npm install
python3 scripts/build_graph.py --input data/spotify_archive_genres.json --output public/graph.json
npm run dev
```

Open the URL printed by Vite (e.g. `http://localhost:5173/new-release-atlas/`).

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

## Chat → playlist (generated from the graph)

At the bottom of the map there's a chat (**♫ Create a playlist**): describe what
you want to hear and the app builds a playlist by **traversing the graph**,
highlighting the chosen tracks and drawing the listening path that connects them.

**No external AI / no API:** the interpretation is a client-side rule engine
([`src/playlist.js`](src/playlist.js)), so it works offline and is free and
private. It understands:

- **genres** ("jazz", "soulful house", "uk jazz", "neo-soul", …)
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

Click a track in the list to isolate it on the graph (with a Spotify link in the
detail panel). *Optional future upgrade:* for free-form prompts you could connect
an LLM via a serverless function (the API key must never live in the client).

### Export to Spotify (no setup)

Every generated playlist has an **↗ Export** button ([`src/export.js`](src/export.js)):
no login, no configuration. We export the **exact Spotify links** of the tracks
(we already have them in the graph, so the match is precise) and hand them to a
tool that creates the playlist on your account:

- on click the links are **copied to the clipboard** and downloaded as **CSV**,
  and **[Spotlistr](https://www.spotlistr.com/search)** opens in a new tab;
- paste the list into Spotlistr → Spotify login (it handles it) → it creates the playlist;
- alternatively: paste the links into a **Spotify desktop** playlist, or import
  the CSV/TXT with **[Soundiiz](https://soundiiz.com/tutorial/import-text-to-spotify)**.

> **Why not the direct API?** On a static site, writing to your account would
> still require a Spotify app + OAuth login (and "text-to-playlist" tools pull
> from the whole catalogue, losing the point of your archive). Exporting the
> exact links and using an external tool avoids any setup while keeping the
> playlist the one built from **your** graph.

---

## Install as an app (PWA)

The app is a **Progressive Web App**: it can be installed on desktop and mobile
and works **offline** after the first visit.

- **Desktop (Chrome/Edge):** the "Install" icon in the address bar, or menu ⋮ →
  *Install New Release Atlas*.
- **iOS (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*.

Technical details (via [`vite-plugin-pwa`](https://vite-pwa-org.netlify.app/)):

- A generated **manifest** (`manifest.webmanifest`) with `scope`/`start_url`
  under the `base` `/new-release-atlas/`, `display: standalone`, theme `#2b2724`.
- A **service worker** (Workbox, `registerType: 'autoUpdate'`) that precaches the
  app shell **and `graph.json`** → the map is available offline. It updates itself
  on every new deploy.
- **Icons** in `public/`: `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`
  (maskable for Android), `apple-touch-icon-180.png` and `favicon.svg`.

> Installing requires **HTTPS** (or `localhost`): it works on the Pages site and
> in `npm run preview`, not by opening files via double-click. In `npm run dev`
> the service worker is disabled by default.

---

## Two-stage data pipeline

The archive goes through two Python scripts before becoming the map. **Neither
uses the Spotify API or requires credentials.**

```
data/spotify_archive.json              (RAW archive: tracks, artists, playlists — source of truth, hand-maintained)
        │
        ▼  scripts/enrich_genres.py     ← adds genres + genre_primary per track
data/spotify_archive_genres.json        (ENRICHED archive)
        │
        ▼  scripts/build_graph.py       ← builds nodes + edges + clusters (idempotent)
public/graph.json                       (the map's input, served statically)
```

- **`scripts/genre_map.py`** — artist→genres map (541 artists) + helper functions.
  It is a **dependency** of `enrich_genres.py`: they must live in the same
  `scripts/` folder.
- **`scripts/enrich_genres.py`** — stage 1: classifies each track by genre.
- **`scripts/build_graph.py`** — stage 2: builds the graph. It is idempotent and
  regenerates the whole graph from the archive's current state.

### How the edges are built

- **shared artist** → strong link
- **shared primary genre** → medium link (sparse kNN)
- **shared secondary genre** → light link
- **same playlist** → weak link

---

## Weekly workflow

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

# 4. Regenerate the graph
python3 scripts/build_graph.py \
    --input data/spotify_archive_genres.json \
    --output public/graph.json

# 5. Commit + push → GitHub Actions republishes by itself
git add -A && git commit -m "update: New Release #NN" && git push
```

> The CI workflow regenerates `graph.json` from the enriched archive on every
> push anyway, so even if you forget step 4 the published site stays consistent.

---

## Handling new / unknown artists

`enrich_genres.py` classifies artists via `genre_map.py`. For unknown artists it
attempts **context inference**: if an artist collaborates, on the same track,
with known artists, it inherits their genres (reduced weight). It stays `unknown`
only if there's no anchor at all, and it is **reported** at the end of the run.

Two ways to classify a new artist:

- **quick** — add it to `data/genre_overrides.json` (no code change):

  ```json
  {
    "Artist Name": ["genre1", "genre2"],
    "Another Artist": ["jazz"]
  }
  ```

- **permanent** — add it to the `GENRES` dictionary in `scripts/genre_map.py`.

Useful `enrich_genres.py` options:

- `--report-missing data/missing_artists.json` — writes, for each artist left
  `unknown`, the track count and known collaborators: useful for classifying it.
- `--fail-on-missing N` — exits with an error if more than `N` remain unclassified.
  Useful in CI to be alerted when a playlist introduces new artists.

### Genre taxonomy (allowed values in overrides)

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
2. installs Python and regenerates `public/graph.json` (`build_graph.py`);
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
found in production and the page stays blank. The component uses
`import.meta.env.BASE_URL` precisely to read `graph.json` from the correct path in
both dev and production.

---

## Project structure

```
new-release-atlas/
├── .github/workflows/deploy.yml      # automatic deploy to GitHub Pages
├── data/
│   ├── spotify_archive.json          # RAW archive (source of truth)
│   ├── spotify_archive_genres.json   # enriched archive (input of build_graph)
│   └── genre_overrides.json          # (optional) extra artist→genres
├── public/
│   └── graph.json                    # GENERATED by build_graph.py
├── scripts/
│   ├── genre_map.py                  # map + API (dependency of enrich_genres)
│   ├── enrich_genres.py              # pipeline stage 1
│   └── build_graph.py                # pipeline stage 2
├── src/
│   ├── MusicNetwork.jsx              # the map component (D3 force graph)
│   ├── Chat.jsx                      # chat panel (prompt → playlist)
│   ├── playlist.js                   # rule engine: prompt → playlist
│   ├── export.js                     # export links/CSV → Spotlistr/Spotify
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
```
