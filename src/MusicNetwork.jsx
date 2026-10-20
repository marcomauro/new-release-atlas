import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import PlaylistHub from "./components/PlaylistHub.jsx";
import PlayerBar, { preloadSpotifyApi } from "./PlayerBar.jsx";
import { preloadYouTubeApi } from "./YouTubePlayer.jsx";
import {
  completeSpotifyAuthIfNeeded, isSpotifyLoggedIn, loginSpotify, setPendingPlay, takePendingPlay,
} from "./spotifyConnect.js";
import { buildPlaylist, buildFromSeed, DEFAULT_LINK_WEIGHTS, DEFAULT_RANDOMNESS, DEFAULT_MOOD } from "./playlist.js";
import {
  SPOTLISTR_URL, playlistLinks, playlistCsv, exportFilename, copyText, downloadFile,
} from "./export.js";
import { INK, PAPER, MUTED, ACCENT, gColor } from "./theme.js";
import { hydrateGraph } from "./graph/hydrate.js";
import { createCanvasMap } from "./graph/canvasMap.js";
import { clusterForce, hashJitter, packGenreAnchors, fitTransform, sparseArtistDrops } from "./graph/layout.js";
import Header from "./components/Header.jsx";
import Legend from "./components/Legend.jsx";
import DetailPanel from "./components/DetailPanel.jsx";
import { MapHints, Credits, HoverCard } from "./components/Overlays.jsx";

/* ----------------------------------------------------------------
   New Release Atlas v2 — force-directed map by inferred GENRE
   Nodes = tracks · Edges = shared artist / shared genre / co-playlist
   Colour = inferred primary genre · interactive legend filter

   This file is the orchestrator: it owns the state, the D3 simulation
   effects and the wiring between the map and the UI. Presentational
   pieces live in components/, force helpers in graph/, colours in theme.
   ---------------------------------------------------------------- */

let GRAPH = null; // populated by loader (hydrateGraph) before MusicNetworkInner mounts

// Node labels: constant ON-SCREEN size in px (the zoom handler counter-scales
// the group's font by 1/k, so this is exactly what the eye sees at any zoom).
// Emphasis mode (route / selected node) bumps it: those labels are the point.
const LABEL_PX = 10;        // desktop base
const MOBILE_LABEL_PX = 11; // mobile base
const ROUTE_LABEL_PX = 11;  // emphasis (route or selection)
// On mobile the size is coupled to the zoom (base × k^0.4, clamped [8,16]):
// perceivable growth when zooming in, gentle shrink when zooming out. The
// previous 0.3 exponent with a 14px cap saturated at k≈2.3 — most of the
// zoom-in range showed no change at all, which read as "not working".
const MOBILE_ZOOM_EXP = 0.4;
// Extra collision radius (graph units) for emphasized nodes: gently pushes
// their close neighbours away so labels have room to breathe. The selection
// boost is smaller — a hub can emphasize 40 neighbours at once.
const ROUTE_NODE_SPACING = 12;
const SELECT_NODE_SPACING = 8;
// Screen margins (px) kept free of map when fitting the WHOLE map: the header
// and legend column on the left (desktop) or the stacked header on top
// (mobile), and the Playlist launcher at the bottom.
const MAP_MARGINS = { l: 230, r: 24, t: 24, b: 56 };
const MOBILE_MAP_MARGINS = { l: 10, r: 10, t: 112, b: 72 };
// Hover on desktop: the track's name shows at once; its neighbours and
// edges light up only after the pointer rests this long on it, so sweeping
// the mouse across the map no longer flashes the whole neighbourhood.
const HOVER_LINKS_DELAY = 450; // ms
// quota di brani con un video YouTube oltre la quale YouTube è la sorgente di default
const YOUTUBE_DEFAULT_MIN = 0.8;

function MusicNetworkInner() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const simRef = useRef(null);
  const labelPxRef = useRef(LABEL_PX); // on-screen label size (emphasis bumps it)
  const routeBoostRef = useRef(null);  // { ids, extra }: nodes getting extra collision room
  const emphRef = useRef(null);        // node datums whose labels get anti-overlap placement
  // Auto-fit: while the first layout settles the camera follows it so the
  // whole map ends up framed. Any manual pan/zoom/drag, a route or a
  // selection hands the camera back to the user (userMovedRef also stops
  // re-fitting on resize).
  const autoFitRef = useRef(true);
  const userMovedRef = useRef(false);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  // id of the hovered track once the pointer has rested on it (full highlight)
  const [hoverLinks, setHoverLinks] = useState(null);
  useEffect(() => {
    setHoverLinks(null);
    if (!hovered) return;
    const t = setTimeout(() => setHoverLinks(hovered.id), HOVER_LINKS_DELAY);
    return () => clearTimeout(t);
  }, [hovered]);
  const [query, setQuery] = useState("");
  const [activeGenre, setActiveGenre] = useState(null);
  const [dims, setDims] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 800,
    h: typeof window !== "undefined" ? window.innerHeight : 600,
  }));
  const [legendOpen, setLegendOpen] = useState(false);

  // Phone-sized viewport: switch to a single-column, touch-first layout.
  const isMobile = dims.w > 0 && dims.w <= 640;
  const showLegend = !isMobile || legendOpen;
  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  // --- playlist hub: generated-playlist state ---
  const [playlist, setPlaylist] = useState(null); // ordered ids of the route on the map
  // The ACTIVE generation (the one drawn on the map): { res, source } where
  // source is { kind: "chat", text } or { kind: "seed", node, size }. The
  // source is what Regenerate re-runs with the current weights/variety/mood.
  const [active, setActive] = useState(null);
  const [history, setHistory] = useState([]); // previous actives, most recent first (capped)
  const [notice, setNotice] = useState(null); // transient feedback: export links, errors
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const routeRef = useRef([]); // node datums of the playlist, used to draw the route
  const playlistSet = useMemo(() => (playlist ? new Set(playlist) : null), [playlist]);
  // read by the resize effect without re-running it on every change
  const playlistRef = useRef(null);
  playlistRef.current = playlist;
  const selectedRef = useRef(null);
  selectedRef.current = selected;

  // --- pesi dei legami, regolabili a mano (default dalla pipeline) ---
  const [weights, setWeights] = useState(
    () => (GRAPH.meta && GRAPH.meta.linkWeights) || DEFAULT_LINK_WEIGHTS
  );
  const [randomness, setRandomness] = useState(DEFAULT_RANDOMNESS);
  // mood/atmosfera per la generazione (influence 0 => ignorato, come prima)
  const [mood, setMood] = useState(() => ({ influence: DEFAULT_MOOD.influence, target: { ...DEFAULT_MOOD.target } }));
  // Comportamento al cambio dei parametri (pesi/varietà/mood) con una playlist
  // attiva. Default OFF: la playlist si rigenera SOLO premendo "Regenerate".
  // ON = comportamento "legacy": rigenera al volo a ogni modifica. Persistito.
  const [liveRegen, setLiveRegen] = useState(() => {
    try { return localStorage.getItem("nra_live_regen") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("nra_live_regen", liveRegen ? "1" : "0"); } catch {}
  }, [liveRegen]);
  // sezione mood/audio del pannello: parte chiusa ad ogni nuova selezione
  const [moodOpen, setMoodOpen] = useState(false);

  // --- ascolto continuo del percorso (mini-player persistente) ---
  const [playIndex, setPlayIndex] = useState(0);
  // altezza reale del mini-player (per non far finire la scheda brano sotto di esso)
  const [playerH, setPlayerH] = useState(0);
  // ogni nuovo percorso riparte dal primo brano
  useEffect(() => { setPlayIndex(0); }, [playlist]);
  // ogni nuova selezione apre la scheda con la sezione mood/audio chiusa
  useEffect(() => { setMoodOpen(false); }, [selected?.id]);
  const playTracks = useMemo(
    () =>
      (playlist || [])
        .map((id) => GRAPH.nodes.find((n) => n.id === id))
        .filter(Boolean)
        .map((n) => ({ id: n.id, title: n.title, artist: n.artist, yt: n.yt })),
    [playlist]
  );

  // --- sorgente di ascolto: con dei match YouTube compare lo switch; YouTube
  // (brani interi, nessun account) diventa il DEFAULT solo quando copre quasi
  // tutto l'archivio — prima il player salterebbe la maggior parte dei brani.
  // La scelta dell'utente resta persistita.
  const sources = useMemo(() => {
    const yt = (GRAPH.meta.sources && GRAPH.meta.sources.youtube) || 0;
    if (!yt) return ["spotify"];
    return yt / GRAPH.nodes.length >= YOUTUBE_DEFAULT_MIN ? ["youtube", "spotify"] : ["spotify", "youtube"];
  }, []);
  const [listenSource, setListenSource] = useState(() => {
    let s = null;
    try { s = localStorage.getItem("nra_source"); } catch {}
    return sources.includes(s) ? s : sources[0];
  });
  useEffect(() => {
    try { localStorage.setItem("nra_source", listenSource); } catch {}
  }, [listenSource]);

  // --- Spotify Connect (full-track opt-in) ---
  const [spotifyConnected, setSpotifyConnected] = useState(() => isSpotifyLoggedIn());
  useEffect(() => {
    let done = false;
    completeSpotifyAuthIfNeeded().then((ok) => {
      if (done || !ok) return;
      setSpotifyConnected(true);
      setListenSource("spotify"); // logged in to listen on Spotify: use it
      // riprende il percorso che stava ascoltando prima del login
      const pending = takePendingPlay();
      if (pending && pending.length) setPlaylist(pending);
    });
    return () => { done = true; };
  }, []);
  const handleSpotifyLogin = useCallback(() => {
    setPendingPlay(playlist || []);
    loginSpotify();
  }, [playlist]);

  const neighbors = useMemo(() => {
    const map = new Map();
    GRAPH.nodes.forEach((n) => map.set(n.id, new Set()));
    GRAPH.links.forEach((l) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      map.get(s)?.add(t);
      map.get(t)?.add(s);
    });
    return map;
  }, []);

  const genreCounts = useMemo(() => {
    const c = {};
    GRAPH.nodes.forEach((n) => (c[n.genre] = (c[n.genre] || 0) + 1));
    return c;
  }, []);

  const matchSet = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    const s = new Set();
    GRAPH.nodes.forEach((n) => {
      if (
        n.title.toLowerCase().includes(q) ||
        n.artist.toLowerCase().includes(q) ||
        n.artists.some((a) => a.toLowerCase().includes(q))
      )
        s.add(n.id);
    });
    return s;
  }, [query]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Pre-carica le API dei player allo start (Spotify, e YouTube se il grafo
  // ha dei match): così l'autoplay del percorso parte subito (controller
  // pronto entro la finestra di user-activation del click).
  useEffect(() => {
    preloadSpotifyApi();
    if (sources.includes("youtube")) preloadYouTubeApi();
  }, [sources]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const view = d3.select(canvas);

    const nodes = GRAPH.nodes.map((d) => ({ ...d }));
    const allLinks = GRAPH.links.map((d) => ({ ...d }));
    const nodesById = new Map(nodes.map((d) => [d.id, d]));
    // Prolific artists' cliques are thinned to a ring with chords for the
    // drawing and the link force (see sparseArtistDrops). The dropped edges
    // still exist in GRAPH (playlist walk, neighbours) and are drawn on demand
    // in the focus layer when their node is hovered or selected.
    const drops = sparseArtistDrops(nodes, allLinks);
    const links = allLinks.filter((_, i) => !drops.has(i));
    const hiddenById = new Map();
    allLinks.forEach((l, i) => {
      if (!drops.has(i)) return;
      const h = { source: nodesById.get(l.source), target: nodesById.get(l.target), weight: l.weight };
      for (const id of [l.source, l.target]) {
        if (!hiddenById.has(id)) hiddenById.set(id, []);
        hiddenById.get(id).push(h);
      }
    });
    // Target ON-SCREEN label size for the current zoom factor. Desktop:
    // constant (labelPxRef). Mobile: softly zoom-coupled — base × k^0.3,
    // clamped to [9, 14] px — so zooming feels natural without ever making
    // the labels unreadable or oversized.
    const labelScreenPx = (k) =>
      isMobile
        ? Math.max(8, Math.min(16, labelPxRef.current * Math.pow(k, MOBILE_ZOOM_EXP)))
        : labelPxRef.current;

    const maxDeg = d3.max(nodes, (d) => d.degree) || 1;
    // Su mobile la tela e' stretta: nodi PIU' PICCOLI (non piu' grandi) cosi'
    // l'area totale dei pallini sta nel canvas e resta spazio VUOTO fra le isole
    // di genere. Nodi grandi su schermo piccolo facevano collassare i cluster in
    // un'unica massa (la collisione vinceva sulle ancore).
    const rScale = d3
      .scaleSqrt()
      .domain([1, maxDeg])
      .range(isMobile ? [3, 8] : [3, 12]);

    const radius = (d) => rScale(d.degree);

    // One canvas paints links, route, nodes and labels (graph/canvasMap.js):
    // the effects below only hand it the state to show.
    const map = createCanvasMap(canvas, { nodes, links, radius });
    map.resize(dimsRef.current.w, dimsRef.current.h);
    map.setLabelPx(labelScreenPx(1));

    // The thinned-out artist edges of the hovered/selected node are painted
    // on demand, so the highlight still shows every real connection.
    const setFocusLinks = (id) => map.setFocusLinks((id && hiddenById.get(id)) || []);

    // Pointer: hit-testing on the canvas replaces the per-circle listeners.
    // Hover only where it really exists (mouse/trackpad): on touch the
    // synthetic hover of a tap would restyle the map before every click.
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let hoverNode = null;
    view
      .on("pointermove.hover", (e) => {
        if (!canHover || e.pointerType !== "mouse") return;
        const [x, y] = d3.pointer(e, canvas);
        const d = map.nodeAt(x, y);
        canvas.style.cursor = d ? "pointer" : "default";
        if (d !== hoverNode) { hoverNode = d; setHovered(d); }
      })
      .on("pointerleave.hover", () => {
        if (hoverNode) { hoverNode = null; setHovered(null); }
      })
      .on("click", (e) => {
        const [x, y] = d3.pointer(e, canvas);
        const d = map.nodeAt(x, y);
        setSelected((prev) => (d && !(prev && prev.id === d.id) ? d : null));
      });

    // Drag a node; a press that misses every node falls through to the zoom
    // (pan). Registered before the zoom so it gets the press first.
    view.call(
      d3
        .drag()
        .container(canvas)
        .subject((e) => {
          const d = map.nodeAt(e.x, e.y);
          return d ? { node: d, x: e.x, y: e.y } : null;
        })
        .on("start", (e) => {
          autoFitRef.current = false;
          if (!e.active) sim.alphaTarget(0.3).restart();
          const d = e.subject.node;
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e) => {
          const t = d3.zoomTransform(canvas);
          e.subject.node.fx = (e.x - t.x) / t.k;
          e.subject.node.fy = (e.y - t.y) / t.k;
        })
        .on("end", (e) => {
          if (!e.active) sim.alphaTarget(0);
          e.subject.node.fx = null;
          e.subject.node.fy = null;
        })
    );

    const zoom = d3
      .zoom()
      .scaleExtent([0.12, 6])
      .on("start", (e) => {
        // a real gesture (wheel, pan, pinch) — not a programmatic transform
        if (e.sourceEvent) { userMovedRef.current = true; autoFitRef.current = false; }
      })
      .on("zoom", (e) => {
        map.setTransform(e.transform);
        // Node labels keep a controlled screen size: desktop is pinned;
        // mobile couples softly to the zoom (base × k^0.4, clamped).
        map.setLabelPx(labelScreenPx(e.transform.k));
      });
    view.call(zoom);
    view.on("dblclick.zoom", null);

    // Genre clustering force — pulls same-genre nodes toward shared anchors,
    // giving spatial separation between genres on top of the link forces.
    // Ancore impacchettate proporzionalmente alla dimensione (riempimento omogeneo).
    const genres = GRAPH.genres;
    let anchorMap = packGenreAnchors(genres, genreCounts, dims);
    const anchor = (genre) => anchorMap.get(genre) || { x: dims.w / 2, y: dims.h / 2 };

    const sameGenre = (l) => l.source.genre === l.target.genre;

    // Same-artist link degree per node. Artist edges form a COMPLETE CLIQUE
    // per artist (n tracks -> n(n-1)/2 springs): a 14-track artist pulls each
    // of its nodes with ~13 short springs at once, packing the group to the
    // collision limit. Normalizing each artist spring by sqrt(clique degree)
    // keeps the total per-node pull comparable to a small artist's, while
    // duos (degree 1) stay at full strength.
    const artistDeg = new Map();
    links.forEach((l) => {
      if ((l.c?.[0] || 0) > 0) {
        const s = l.source.id ?? l.source;
        const t = l.target.id ?? l.target;
        artistDeg.set(s, (artistDeg.get(s) || 0) + 1);
        artistDeg.set(t, (artistDeg.get(t) || 0) + 1);
      }
    });
    const cliqueNorm = (d) => {
      if ((d.c?.[0] || 0) <= 0) return 1;
      const s = d.source.id ?? d.source;
      const t = d.target.id ?? d.target;
      return 1 / Math.sqrt(Math.max(1, Math.max(artistDeg.get(s) || 1, artistDeg.get(t) || 1)));
    };

    // Collision radius accessor. Emphasized nodes (routeBoostRef: route OR the
    // selected node's neighbourhood) get extra room so close neighbours are
    // gently pushed away and their labels can breathe; re-initialized by the
    // emphasis effect via sim.force("collide").radius(...).
    const collideRadius = (d) =>
      rScale(d.degree) +
      (isMobile ? 0.5 : 1.5) +
      hashJitter(d.id) * (isMobile ? 1 : 4) +
      (routeBoostRef.current && routeBoostRef.current.ids.has(d.id) ? routeBoostRef.current.extra : 0);

    // Whole-map fit: all nodes (+ the largest radius) inside the free area.
    const mapFit = () =>
      fitTransform(nodes, dimsRef.current, isMobile ? MOBILE_MAP_MARGINS : MAP_MARGINS, { pad: 14 });
    const toZoom = (t) => d3.zoomIdentity.translate(t.x, t.y).scale(t.k);
    // Camera follow while the layout settles: ease 12% toward the fit each
    // tick, so the map is framed without a visible jump at the end.
    const followFit = () => {
      const f = mapFit();
      const c = d3.zoomTransform(canvas);
      const a = 0.12;
      view.call(zoom.transform, toZoom({ x: c.x + (f.x - c.x) * a, y: c.y + (f.y - c.y) * a, k: c.k + (f.k - c.k) * a }));
    };

    const sim = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d) => d.id)
          // Stesso genere: legami piu' corti; generi diversi: piu' lunghi.
          .distance((d) => (55 / (0.4 + d.weight * 0.22)) * (sameGenre(d) ? 0.7 : 2.4))
          // Stesso genere: attrazione piu' forte; generi diversi: molto debole
          // (0.12) cosi' i cluster non si tirano addosso e restano separati.
          .strength((d) => Math.min(1, d.weight * 0.1) * (sameGenre(d) ? 1.6 : 0.12) * cliqueNorm(d))
      )
      // Repulsione piu' contenuta: blob piu' compatti -> piu' vuoto fra i cluster.
      .force("charge", d3.forceManyBody().strength(-34))
      // Ancore forti -> ogni genere collassa stretto sul proprio territorio.
      .force("x", d3.forceX((d) => anchor(d.genre).x).strength(0.26))
      .force("y", d3.forceY((d) => anchor(d.genre).y).strength(0.26))
      // Coesione esplicita per cluster. Lo stesso autore si attrae, ma con una
      // forza MODERATA. Una coesione troppo alta (era 0.5) comprime i nodi dello
      // stesso autore fino al limite di impacchettamento: con dischi di collisione
      // ~uguali questo fa cristallizzare un reticolo ESAGONALE (l'impacchettamento
      // 2D più denso). Tenendola bassa lasciamo che siano le distanze-preferite
      // dei link a dare la forma — più organica — mentre i brani dello stesso
      // autore restano comunque vicini grazie ai link d'autore (peso 3.0).
      .force("genreCohesion", clusterForce((n) => n.genre, 0.06))
      // Adaptive: full pull for duos, tamed for prolific artists (see layout.js).
      .force("artistCohesion", clusterForce((n) => n.genre + "|" + n.artist, 0.15, (n) => 1 / Math.sqrt(Math.max(1, n / 2))))
      // Collisione = leva per separare i nodi densi senza "aprire" il cluster
      // (link e coesione lo tengono comunque unito). Padding piccolo (mobile 0.5,
      // desktop 1.5) -> blob COMPATTI cosi' le isole di genere restano staccate;
      // il jitter sul raggio resta alto (dischi disuguali) per rompere il
      // reticolo esagonale. strength/iterations alti fanno rispettare la spaziatura.
      .force(
        "collide",
        d3
          .forceCollide()
          .radius(collideRadius)
          // strength 1 + 3 iterazioni: la spaziatura minima e' sempre rispettata,
          // i pallini non si sovrappongono mai nemmeno sotto la spinta delle ancore.
          .strength(1)
          .iterations(3)
      )
      .on("tick", () => {
        map.requestDraw();
        if (autoFitRef.current) followFit();
      })
      .on("end", () => {
        // settled: land exactly on the fit, then stop following
        if (!autoFitRef.current) return;
        autoFitRef.current = false;
        view.transition().duration(400).call(zoom.transform, toZoom(mapFit()));
      });

    // Greedy label placement for the EMPHASIZED nodes (the active route, or
    // the selected node + its neighbours): works in SCREEN space (label fonts
    // are screen-controlled), measures each label's real width and tries 10
    // candidate positions around the node (right/left x 5 vertical tiers) in
    // priority order, picking the first that doesn't overlap the labels
    // already placed (or the least-overlapping one as a fallback). Runs after
    // the settle, and again on every zoom end while an emphasis is active.
    // Cost: O(n²) pairwise checks on n ≤ ~40 labels — negligible.
    const placeLabels = () => {
      const t = d3.zoomTransform(canvas);
      const k = t.k;
      const offsets = new Map(); // everyone else keeps the default anchor
      const pts = emphRef.current || [];
      if (pts.length < 2) { map.setLabelOffsets(offsets); return; }
      const placed = [];
      const grow = 2; // safety margin around each box, px
      const overlapArea = (a, b) => {
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + grow;
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + grow;
        return w > 0 && h > 0 ? w * h : 0;
      };
      for (const p of pts) {
        const w = map.measureLabel(p); // screen px
        const h = labelScreenPx(k) + 4; // real bbox: current label size + halo
        const sx = p.x * k + t.x;
        const sy = p.y * k + t.y;
        const off = rScale(p.degree) * k + 5;
        const cands = [
          { dx: off, dy: 4, anchor: "start" },
          { dx: off, dy: -9, anchor: "start" },
          { dx: off, dy: 17, anchor: "start" },
          { dx: -off, dy: 4, anchor: "end" },
          { dx: -off, dy: -9, anchor: "end" },
          { dx: -off, dy: 17, anchor: "end" },
          // second ring: two extra vertical tiers for the densest spots
          { dx: off, dy: -22, anchor: "start" },
          { dx: off, dy: 30, anchor: "start" },
          { dx: -off, dy: -22, anchor: "end" },
          { dx: -off, dy: 30, anchor: "end" },
        ];
        let best = null;
        let bestArea = Infinity;
        for (const c of cands) {
          const box = { x: c.anchor === "start" ? sx + c.dx : sx + c.dx - w, y: sy + c.dy - h + 3, w, h };
          let area = 0;
          for (const q of placed) area += overlapArea(box, q);
          if (area < bestArea) { bestArea = area; best = { c, box }; }
          if (area === 0) break;
        }
        placed.push(best.box);
        // stored in graph units, like the SVG dx/dy were: between two
        // placements a zoom scales the offsets with the map
        offsets.set(p.id, { dx: best.c.dx / k, dy: best.c.dy / k, anchor: best.c.anchor });
      }
      map.setLabelOffsets(offsets);
    };
    // Re-distribute on zoom end: overlaps depend on the zoom factor.
    zoom.on("end.emphasisLabels", () => {
      if (emphRef.current && emphRef.current.length > 1) placeLabels();
    });

    simRef.current = { sim, map, zoom, view, canvas, nodes, links, nodesById, collideRadius, placeLabels, labelScreenPx, setFocusLinks, mapFit, toZoom };
    // dev-only handle for the browser smoke tests
    if (import.meta.env.DEV) window.__atlasMap = simRef.current;
    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!simRef.current) return;
    const { sim, map } = simRef.current;
    map.resize(dims.w, dims.h);
    // Ricalcola le ancore impacchettate per le nuove dimensioni (init e resize
    // condividono la stessa geometria proporzionale alla dimensione dei cluster).
    const anchorMap = packGenreAnchors(GRAPH.genres, genreCounts, dims);
    const at = (d) => anchorMap.get(d.genre) || { x: dims.w / 2, y: dims.h / 2 };
    sim
      .force("x", d3.forceX((d) => at(d).x).strength(0.26))
      .force("y", d3.forceY((d) => at(d).y).strength(0.26));
    // the layout re-settles for the new size: re-frame it, unless the user
    // has taken the camera or a route/selection owns it
    if (!userMovedRef.current && !playlistRef.current && !selectedRef.current) autoFitRef.current = true;
    sim.alpha(0.3).restart();
  }, [dims, genreCounts]);

  // Restyle "strutturale" (selezione, filtri, ricerca, playlist): calcola lo
  // stato di ogni nodo e arco e lo passa al canvas, che ridisegna al frame
  // successivo. NON dipende dall'hover, gestito a parte (effetto leggero qui
  // sotto) come sovrapposizione temporanea.
  useEffect(() => {
    if (!simRef.current) return;
    const { map, nodes, links } = simRef.current;
    const focus = selected;
    const focusId = focus?.id;
    const selId = selected?.id; // solo il brano cliccato ha l'alone (non l'hover)
    const nbr = focusId ? neighbors.get(focusId) : null;
    // brano attualmente in riproduzione nel percorso (evidenziato sul grafo)
    const currentId =
      !focusId && playlistSet && playlist && playlist.length
        ? playlist[Math.min(playIndex, playlist.length - 1)]
        : null;

    const dim = (d) => {
      if (matchSet && !matchSet.has(d.id)) return true;
      if (activeGenre && d.genre !== activeGenre) return true;
      if (focusId && d.id !== focusId && !nbr?.has(d.id)) return true;
      if (!focusId && playlistSet && !playlistSet.has(d.id)) return true;
      return false;
    };

    const n = nodes.length;
    const v = {
      nodeAlpha: new Float32Array(n),
      interactive: new Uint8Array(n),
      strokeW: new Float32Array(n),
      strokeC: new Array(n),
      glow: new Uint8Array(n),
      labelAlpha: new Float32Array(n),
      linkAlpha: new Float32Array(links.length),
      // Nascondi il percorso della playlist mentre un nodo e' in focus (dettaglio).
      showRoute: !focusId && !!playlistSet && playlistSet.size > 1,
    };
    nodes.forEach((d, i) => {
      const lit = (focusId && d.id === focusId) || (!focusId && playlistSet?.has(d.id));
      const dimmed = !lit && dim(d);
      v.nodeAlpha[i] = lit ? 1 : dimmed ? 0.08 : 0.96;
      // Dimmed background nodes must not catch taps/drags: while a node is
      // focused (or a filter/playlist is active) only the highlighted layer
      // stays interactive, so a drag over the faded nodes pans/zooms the view
      // instead of grabbing a node underneath.
      v.interactive[i] = dimmed ? 0 : 1;
      v.strokeW[i] =
        d.id === currentId ? 3 : d.id === focusId || playlistSet?.has(d.id) ? 2.4 : matchSet?.has(d.id) ? 2 : 1.2;
      v.strokeC[i] =
        d.id === selId || d.id === currentId
          ? ACCENT
          : d.id === focusId || matchSet?.has(d.id) || playlistSet?.has(d.id)
          ? INK
          : PAPER;
      // Alone ciano statico: sul brano selezionato e su quello in riproduzione.
      v.glow[i] = d.id === selId || d.id === currentId ? 1 : 0;
      v.labelAlpha[i] = focusId
        ? d.id === focusId ? 1 : nbr?.has(d.id) ? 0.8 : 0
        : matchSet
        ? matchSet.has(d.id) ? 1 : 0
        : playlistSet
        ? playlistSet.has(d.id) ? 1 : 0
        : 0;
    });
    links.forEach((l, i) => {
      const s = l.source.id;
      const t = l.target.id;
      v.linkAlpha[i] = focusId
        ? s === focusId || t === focusId ? 0.5 : 0.02
        : activeGenre
        ? 0.04
        : matchSet
        ? matchSet.has(s) || matchSet.has(t) ? 0.22 : 0.02
        : playlistSet
        ? playlistSet.has(s) && playlistSet.has(t) ? 0.15 : 0.02
        : 0.1;
    });
    map.setView(v);
  }, [selected, matchSet, activeGenre, neighbors, playlistSet, playlist, playIndex]);

  // Effetto LEGGERO per l'hover: il canvas sovrappone allo stato strutturale,
  // senza ricalcolare la vista. Subito: bordo e nome del brano (hover
  // "leggero", la mappa non si spegne). Dopo HOVER_LINKS_DELAY fermi sul
  // pallino: anche vicini e archi incidenti, con il resto che sfuma.
  // Su touch l'hover non c'e'.
  useEffect(() => {
    if (!simRef.current) return;
    const { map, nodesById, setFocusLinks } = simRef.current;
    const id = !selected && hovered ? hovered.id : null;
    const deep = !!id && hoverLinks === id;
    // thinned-out artist edges of the focused node (selection wins over hover)
    setFocusLinks(selected ? selected.id : deep ? id : null);
    if (!id) { map.setHover(null); return; }
    const nbr = new Set();
    if (deep) for (const x of neighbors.get(id) || []) nbr.add(nodesById.get(x).index);
    map.setHover({ index: nodesById.get(id).index, nbr, light: !deep });
  }, [hovered, hoverLinks, selected, neighbors]);

  // Aggiorna il percorso della playlist e inquadra i suoi nodi (solo al cambio).
  useEffect(() => {
    if (!simRef.current) return;
    const { nodesById, map, view, zoom, toZoom } = simRef.current;
    const pts = (playlist || []).map((id) => nodesById.get(id)).filter(Boolean);
    routeRef.current = pts;
    map.setRoute(pts);
    if (pts.length) {
      autoFitRef.current = false;
      // Inquadra nell'area utile, lasciando margini per header/legenda (sx, alto)
      // e per il pannello chat (basso): cosi i nodi non finiscono sotto la UI.
      // Su mobile la UI e' impilata in alto/in basso, quindi i margini cambiano.
      const Lm = isMobile ? 24 : Math.min(300, dims.w * 0.32);
      const Rm = isMobile ? 24 : 56;
      const Tm = isMobile ? 120 : 130;
      const Bm = isMobile ? Math.min(320, dims.h * 0.42) : Math.min(260, dims.h * 0.34);
      const t = fitTransform(pts, dims, { l: Lm, r: Rm, t: Tm, b: Bm }, { pad: 60, maxK: 2 });
      view.transition().duration(750).call(zoom.transform, toZoom(t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist]);

  // EMPHASIS mode — one mechanism for two situations: the active ROUTE, or
  // the SELECTED node with its neighbourhood. Emphasized nodes get bigger
  // labels (11px), extra collision room (their close neighbours slide away at
  // low alpha, without reshuffling the clusters) and the greedy anti-overlap
  // label placement. Cheap: placement is O(n²) on ≤ ~40 labels, and the only
  // visible cost is the gentle re-settle (smaller boost for selections).
  useEffect(() => {
    if (!simRef.current) return;
    const { sim, map, canvas, collideRadius, placeLabels, labelScreenPx, nodesById } = simRef.current;
    let pts = null;
    if (selected) {
      autoFitRef.current = false;
      const ids = [selected.id, ...(neighbors.get(selected.id) || [])];
      pts = ids.map((id) => nodesById.get(id)).filter(Boolean);
      routeBoostRef.current = { ids: new Set(ids), extra: SELECT_NODE_SPACING };
    } else if (routeRef.current && routeRef.current.length > 1) {
      pts = routeRef.current;
      routeBoostRef.current = { ids: new Set(pts.map((p) => p.id)), extra: ROUTE_NODE_SPACING };
    } else {
      routeBoostRef.current = null;
    }
    emphRef.current = pts;

    // label size for the mode, applied immediately at the current zoom
    labelPxRef.current = pts ? ROUTE_LABEL_PX : isMobile ? MOBILE_LABEL_PX : LABEL_PX;
    map.setLabelPx(labelScreenPx(d3.zoomTransform(canvas).k));

    // re-init collision radii and let the layout breathe
    sim.force("collide").radius(collideRadius);
    sim.alpha(pts ? (selected ? 0.18 : 0.25) : 0.12).restart();

    // place labels after the settle (selection settles faster than the
    // route's fit-zoom); zoom-end re-runs placement after manual pan/zoom
    const timer = setTimeout(placeLabels, pts ? (selected ? 700 : 1000) : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, playlist, neighbors, isMobile]);

  const resetView = useCallback(() => {
    if (!simRef.current) return;
    const { view, zoom, mapFit, toZoom } = simRef.current;
    // back to the framed overview (and to re-framing on resize)
    autoFitRef.current = false;
    userMovedRef.current = false;
    view.transition().duration(600).call(zoom.transform, toZoom(mapFit()));
    setSelected(null);
    setQuery("");
    setActiveGenre(null);
    setPlaylist(null);
  }, []);

  // Promote a successful generation to ACTIVE (the previous active moves to
  // the history). A failed prompt only raises a notice — it does NOT clear
  // the playlist currently on the map.
  const activate = useCallback((res, source) => {
    setHistory((h) => (activeRef.current ? [activeRef.current, ...h].slice(0, 8) : h));
    setActive({ res, source });
    setPlaylist([...res.ids]);
    setNotice(null);
  }, []);
  // Ref mirror of `active` so activate() can read it without re-creating
  // every handler that depends on it.
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current = active; }, [active]);

  // Prompt bar: interpret the text and build a playlist by walking the graph.
  const handleChat = useCallback((text) => {
    setChatInput("");
    const res = buildPlaylist(GRAPH, text, weights, randomness, mood);
    setSelected(null);
    setActiveGenre(null);
    setQuery("");
    if (res.ok && res.ids.length) activate(res, { kind: "chat", text });
    else setNotice({ error: true, text: "I couldn't build a playlist from that. Try a genre, a mood, or an artist name." });
  }, [weights, randomness, mood, activate]);

  const pickTrack = useCallback((id) => {
    const n = GRAPH.nodes.find((x) => x.id === id);
    if (n) setSelected(n);
  }, []);

  // ▶ Play on the active card: re-shows route + player (even after a Reset or
  // after closing the player) and COLLAPSES the hub so the route on the map is
  // immediately visible instead of hidden behind the panel.
  const onPlayActive = useCallback((item) => {
    if (item?.res?.ids?.length) setPlaylist([...item.res.ids]);
    setChatOpen(false);
  }, []);

  // ↩ Restore from history: swap it with the current active.
  const onRestore = useCallback((item) => {
    setHistory((h) => {
      const rest = h.filter((x) => x !== item);
      return activeRef.current ? [activeRef.current, ...rest].slice(0, 8) : rest;
    });
    setActive(item);
    setPlaylist([...item.res.ids]);
    setNotice(null);
  }, []);

  // Dal mini-player: apre il dettaglio del brano e centra il nodo sulla mappa.
  const onOpenTrack = useCallback((id) => {
    const n = GRAPH.nodes.find((x) => x.id === id);
    if (!n) return;
    setSelected(n);
    const S = simRef.current;
    const nd = S && S.nodesById.get(id);
    if (nd && nd.x != null) {
      autoFitRef.current = false;
      const t = d3.zoomIdentity.translate(dims.w / 2, dims.h / 2).scale(1.5).translate(-nd.x, -nd.y);
      S.view.transition().duration(600).call(S.zoom.transform, t);
    }
  }, [dims]);


  // Generate a playlist seeded on the selected node, following the graph
  // connections. Closes the detail card and opens the hub on the result.
  const generateFromNode = useCallback((node) => {
    if (!node) return;
    const res = buildFromSeed(GRAPH, node, 18, weights, randomness, mood);
    setSelected(null);
    setActiveGenre(null);
    setQuery("");
    setChatOpen(true);
    if (res.ok && res.ids.length) activate(res, { kind: "seed", node, size: 18 });
    else setNotice({ error: true, text: `Couldn't grow a playlist from "${node.title}" — the track has too few connections.` });
  }, [weights, randomness, mood, activate]);

  const clearPlaylist = useCallback(() => setPlaylist(null), []);

  // Regenerate the ACTIVE playlist from its own source (prompt text or seed
  // track) with the CURRENT weights/variety/mood. Updates the active card in
  // place — it's the same playlist re-tuned, so it does NOT go to history.
  const regenerateFromLast = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    const s = a.source;
    const res =
      s.kind === "seed"
        ? buildFromSeed(GRAPH, s.node, s.size || 18, weights, randomness, mood)
        : buildPlaylist(GRAPH, s.text, weights, randomness, mood);
    if (!res.ok || !res.ids.length) return;
    setActive({ ...a, res });
    setPlaylist([...res.ids]);
  }, [weights, randomness, mood]);

  // Comportamento "legacy" (liveRegen ON): al cambio dei parametri rigenera al
  // volo, con debounce (non ad ogni scatto dello slider ma quando ci si ferma).
  // Default OFF: non fa nulla, la rigenerazione avviene solo con "Regenerate".
  useEffect(() => {
    if (!liveRegen) return;
    const t = setTimeout(regenerateFromLast, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, randomness, mood, liveRegen]);

  // --- zero-setup export: exact Spotify links + CSV, then Spotlistr/Spotify ---
  // Feedback lands in the hub's notice line, right under the card's actions.
  const handleExport = useCallback(async (res) => {
    if (!res || !res.ok) return;
    // Open Spotlistr right away: staying inside the click gesture avoids the popup blocker.
    window.open(SPOTLISTR_URL, "_blank", "noopener");
    const links = playlistLinks(res);
    downloadFile(exportFilename(res, "csv"), playlistCsv(res), "text/csv;charset=utf-8");
    const copied = await copyText(links);
    setNotice({
      text:
        `${res.tracks.length} tracks exported — Spotify links ${
          copied ? "copied to clipboard" : "in the downloaded CSV"
        } and CSV saved. Paste them into Spotlistr (opened in a new tab), ` +
        `or into a Spotify desktop playlist.`,
      link: SPOTLISTR_URL,
      linkLabel: "Open Spotlistr ↗",
    });
    setChatOpen(true);
  }, []);

  const meta = GRAPH.meta;
  const orderedGenres = GRAPH.genres.filter((g) => genreCounts[g]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100dvh",
        background: PAPER,
        fontFamily: "'Inter', system-ui, sans-serif",
        overflow: "hidden",
        color: INK,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,500;1,400&family=Inter:wght@400;500;600&display=swap');
        .mn-input::placeholder { color: ${MUTED}; }
        .mn-input:focus { outline: none; border-color: ${INK}; }
        .mn-chip { transition: all .15s ease; }
        .mn-chip:hover { transform: translateX(2px); }
        @media (max-width: 640px) {
          /* 16px keeps iOS Safari from auto-zooming when an input is focused. */
          .mn-input, .mn-chat input { font-size: 16px !important; }
          /* No hover translate on touch — taps shouldn't nudge rows. */
          .mn-chip:hover { transform: none; }
        }
      `}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.04,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, #000 1px, transparent 0)",
          backgroundSize: "22px 22px",
          zIndex: 1,
        }}
      />

      <Header
        isMobile={isMobile}
        meta={meta}
        genreCount={orderedGenres.length}
        query={query}
        setQuery={setQuery}
        legendOpen={legendOpen}
        setLegendOpen={setLegendOpen}
        onReset={resetView}
      />

      {showLegend && (
        <Legend
          isMobile={isMobile}
          genres={orderedGenres}
          genreCounts={genreCounts}
          activeGenre={activeGenre}
          setActiveGenre={setActiveGenre}
        />
      )}

      {!isMobile && <MapHints />}

      {/* Credits are hidden on mobile while the player is active or the chat
          is open, so they don't overlap the bottom bar. */}
      {(!isMobile || (!playTracks.length && !chatOpen)) && <Credits isMobile={isMobile} />}

      <div ref={wrapRef} style={{ position: "absolute", inset: 0, zIndex: 2 }}>
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: dims.w,
            height: dims.h,
            // Let d3-zoom own all touch gestures (pinch to zoom, drag to pan)
            // instead of the browser scrolling/zooming the page.
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        />
      </div>

      {selected && (
        <DetailPanel
          track={selected}
          onClose={() => setSelected(null)}
          isMobile={isMobile}
          reserveBottom={playTracks.length ? playerH + 36 : 20}
          moodOpen={moodOpen} setMoodOpen={setMoodOpen}
          onGenerate={generateFromNode}
          showEmbed={!playlist}
          listenSource={listenSource}
        />
      )}

      {!isMobile && hovered && !selected && <HoverCard track={hovered} />}

      <PlaylistHub
        open={chatOpen}
        setOpen={setChatOpen}
        value={chatInput}
        onChange={setChatInput}
        onSubmit={handleChat}
        active={active}
        history={history}
        notice={notice}
        onPick={pickTrack}
        onPlay={onPlayActive}
        onExport={handleExport}
        onRegenerate={regenerateFromLast}
        onRestore={onRestore}
        genreColor={gColor}
        bottomOffset={playTracks.length ? playerH + 16 : 0}
        weights={weights}
        setWeights={setWeights}
        randomness={randomness}
        setRandomness={setRandomness}
        mood={mood}
        setMood={setMood}
        liveRegen={liveRegen}
        setLiveRegen={setLiveRegen}
      />

      {/* Ascolto continuo del percorso: mini-player persistente che incatena i brani */}
      {playTracks.length > 0 && (
        <PlayerBar
          tracks={playTracks}
          index={Math.min(playIndex, playTracks.length - 1)}
          setIndex={setPlayIndex}
          onClose={clearPlaylist}
          bottomGap={20}
          connected={spotifyConnected}
          onLogin={handleSpotifyLogin}
          source={listenSource}
          sources={sources}
          onSource={setListenSource}
          isMobile={isMobile}
          onOpenTrack={onOpenTrack}
          onHeight={setPlayerH}
        />
      )}
    </div>
  );
}


export default function MusicNetwork() {
  const [ready, setReady] = React.useState(GRAPH !== null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (GRAPH !== null) return;
    fetch(import.meta.env.BASE_URL + "graph.json")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        GRAPH = hydrateGraph(data);
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return (
      <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#c75b4a" }}>
        Error loading graph.json: {error}
      </div>
    );
  if (!ready)
    return (
      <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#9a938a" }}>
        Loading the map…
      </div>
    );
  return <MusicNetworkInner />;
}
