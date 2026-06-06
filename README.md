# New Release Atlas

Interactive **atlas of my music archive** (New Release Playlists): a navigable
map that reads in two layers at once —

1. **Classification** — `Archive › Genre › Artist › Track`, drawn as nested
   circles (circle-packing). Each genre is a *territory*, artists are
   sub-groups inside it, and tracks are the data points.
2. **Network** — selecting a track reveals its **connections** to the rest of
   the archive (shared artist / genre / co-playlist). Clicking a connected
   track hops to it and redraws its network, so you navigate the collection
   node by node.

Node colour is the **inferred primary genre**; node size is proportional to
`sqrt(degree)` (how connected a track is). Playlists generated from the chat are
drawn on the same layer as an ordered **listening path**.

Static app: **Vite + React 18 + D3**, with automatic deploy to **GitHub Pages**.
Data is loaded **at runtime** via `fetch` from `graph.json` (not inlined in the
bundle).

Current state: **468 tracks · 281 artists · 3391 links · 12 genres**
(playlists #12–#32).

Live: <https://marcomauro.github.io/new-release-atlas/>

---

## How to read / navigate it

- **Drill down (classification):** click a **genre** circle to enter its
  territory and reveal its artists and track titles; click an **artist** to zoom
  further. The **breadcrumb** (top-left) and the **genre index** (bottom-left,
  numbered like a catalogue) jump to any level.
- **Explore the network:** click any **track**. The genre territories stay as a
  faded backdrop, arcs fan out to every connected track (thickness/opacity ∝
  link strength), and the view frames the neighbourhood so you can see *where*
  the connections lead across genres.
- **Hop through the graph:** click a connected track — on the map (its marker)
  or in the detail panel's **Network** list — to recentre on it. The list is the
  textual version of the same network: each row shows the relation (*same
  artist*, the shared genre, or *affinity / playlist*) and a link-strength bar.
- **Search:** filter by track title or artist; non-matching tracks dim.
- **Back out:** click the background to go up one level; the `×` in the detail
  panel returns to the full atlas.

---

## Stack

- **Vite** (build, dev server) + **React 18** (no TypeScript)
- **D3** for the circle-packing layout, the zoom/interpolation, and the
  network/route overlay
- **GitHub Actions** for build + deploy to Pages

> The previous experimental 3D view has been removed. `three`,
> `3d-force-graph`, `three-spritetext` and `src/Graph3D.jsx` are therefore no
> longer used — see [Removed: 3D view](#removed-3d-view) for optional cleanup.

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

The chat (**♫ Create a playlist**) builds a playlist by **traversing the graph**
and draws it on the atlas as an **ordered listening path** (numbered stops
connected in sequence), framing the route and fading the rest.

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
- the final order is a "nearest-neighbour" path over the links, for a smooth
  listen.

Click a track in the list to isolate it on the atlas (and open its network +
Spotify link). You can also click any track on the map and hit **♫ playlist da
qui** in its detail panel: this seeds a playlist from that track and grows it
along the graph connections.

### Export to Spotify (no setup)

Every generated playlist has an **↗ Export** button ([`src/export.js`](src/export.js)):
no login, no configuration. We export the **exact Spotify links** of the tracks
(we already have them in the graph, so the match is precise) and hand them to a
tool that creates the playlist on your account:

- on click the links are **copied to the clipboard** and downloaded as **CSV**,
  and **[Spotlistr](https://www.spotlistr.com/search)** opens in a new tab;
- paste the list into Spotlistr → Spotify login (it handles it) → it creates the
  playlist;
- alternatively: paste the links into a **Spotify desktop** playlist, or import
  the CSV/TXT with **[Soundiiz](https://soundiiz.com/tutorial/import-text-to-spotify)**.

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
- A **service worker** (Workbox, `registerType: 'autoUpdate'`) that precaches
  the app shell **and `graph.json`** → the map is available offline. It updates
  itself on every new deploy.
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

- **`scripts/genre_map.py`** — artist→genres map (541 artists) + helper
  functions. It is a **dependency** of `enrich_genres.py`: they must live in the
  same `scripts/` folder.
- **`scripts/enrich_genres.py`** — stage 1: classifies each track by genre.
- **`scripts/build_graph.py`** — stage 2: builds the graph. It is idempotent and
  regenerates the whole graph from the archive's current state.

### How the edges are built

The same edges power both the playlist engine and the **network overlay** you
see when selecting a track (link weight drives arc thickness/opacity and the
ordering of connected tracks in the detail panel):

- **shared artist** → strong link
- **shared primary genre** → medium link (sparse kNN)
- **shared secondary genre** → light link
- **same playlist** → weak link

`graph.json` shape (consumed by `src/MusicNetwork.jsx`):

```jsonc
{
  "genres": ["neo-soul", "electronic", "jazz", "…"],
  "nodes": [
    {
      "id": "…", "title": "…", "artist": "…", "artists": ["…"],
      "genre": "neo-soul", "genres": ["neo-soul", "jazz"],
      "degree": 15, "url": "https://open.spotify.com/track/…", "duration": "5:38"
    }
  ],
  "links": [ { "source": "<id>", "target": "<id>", "weight": 4.2 } ]
}
```

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
with known artists, it inherits their genres (reduced weight). It stays
`unknown` only if there's no anchor at all, and it is **reported** at the end of
the run.

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
- `--fail-on-missing N` — exits with an error if more than `N` remain
  unclassified. Useful in CI to be alerted when a playlist introduces new
  artists.

### Genre taxonomy (allowed values in overrides)

```
soulful-house · broken-beat · uk-jazz · jazz · neo-soul · soul-funk
hip-hop · electronic · downtempo · world · alt · classical
```

(`unknown` is the fallback, to be avoided in overrides.)

> Genre **colours** and **display labels** for the map are defined at the top of
> `src/MusicNetwork.jsx` (`GENRE_COLOR`, `GENRE_LABEL`). Add an entry there when
> introducing a new genre to the taxonomy.

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

If the repo is renamed, update `base` accordingly — otherwise the assets won't
be found in production and the page stays blank. The component uses
`import.meta.env.BASE_URL` precisely to read `graph.json` from the correct path
in both dev and production.

---

## Visualization internals

All the front-end lives in `src/MusicNetwork.jsx` (a single component):

- **Layout** — a `d3.pack()` over a `genre › artist › track` hierarchy built
  from `graph.json`. Leaf value is `1 + sqrt(degree)`, so well-connected tracks
  read larger; genre territories are sized by their content.
- **Zoom** — a Bostock-style *zoomable circle packing*: clicking a circle
  interpolates the view (`d3.interpolateZoom`) to frame it; labels reveal
  progressively (`parent === focus`).
- **Overlay** — a layer on top of the packed circles draws the **network**
  (arcs from the selected track to its neighbours, coloured by the neighbour's
  genre) or the **playlist route** (an ordered Catmull-Rom path), with
  fixed-radius markers so the active set stays visible at any zoom.
- **Type** — `Spectral` (display, genre names) + `IBM Plex Mono` (catalogue
  numbers and metadata); paper/ink editorial palette.

`Chat.jsx`, `playlist.js` and `export.js` are unchanged from the previous
version and keep the same contracts.

### Removed: 3D view

The default visualization no longer ships a 3D mode. If you want a lighter
install, you can prune the now-unused pieces:

```bash
npm rm 3d-force-graph three three-spritetext
rm src/Graph3D.jsx
```

(Leaving them in place is harmless — they are simply never imported.)

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
│   ├── MusicNetwork.jsx              # the atlas: classification + network + route (D3)
│   ├── Chat.jsx                      # chat panel (prompt → playlist)
│   ├── playlist.js                   # rule engine: prompt → playlist
│   ├── export.js                     # export links/CSV → Spotlistr/Spotify
│   ├── Graph3D.jsx                   # (unused) legacy 3D view — safe to remove
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
```
