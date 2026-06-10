import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import Chat from "./Chat.jsx";
import PlayerBar, { preloadSpotifyApi } from "./PlayerBar.jsx";
import {
  completeSpotifyAuthIfNeeded, isSpotifyLoggedIn, loginSpotify, setPendingPlay, takePendingPlay,
} from "./spotifyConnect.js";
import { buildPlaylist, buildFromSeed, DEFAULT_LINK_WEIGHTS } from "./playlist.js";
import {
  SPOTLISTR_URL, playlistLinks, playlistCsv, exportFilename, copyText, downloadFile,
} from "./export.js";

let GRAPH = null; // populated by loader before MusicNetworkInner mounts

/* ----------------------------------------------------------------
   New Release Atlas v2 — force-directed map by inferred GENRE
   Nodes = tracks · Edges = shared artist / shared genre / co-playlist
   Colour = inferred primary genre · interactive legend filter
   ---------------------------------------------------------------- */

// GRAPH is loaded at runtime from /graph.json (see useEffect below)

// Genre palette — each genre its own hue, editorial / muted.
const GENRE_COLOR = {
  "neo-soul": "#c75b4a",
  "electronic": "#3a7d8c",
  "jazz": "#d39a3e",
  "alt": "#8a6d9e",
  "uk-jazz": "#6b8e5a",
  "hip-hop": "#b5697e",
  "world": "#bf8b4a",
  "soulful-house": "#4f9e9e",
  "soul-funk": "#9e6b52",
  "broken-beat": "#7d8c4f",
  "classical": "#7a8aa0",
  "unknown": "#b8b0a4",
};
const GENRE_LABEL = {
  "neo-soul": "Neo-Soul / R&B",
  "electronic": "Electronic",
  "jazz": "Jazz",
  "alt": "Alt / Indie",
  "uk-jazz": "UK Jazz",
  "hip-hop": "Hip-Hop",
  "world": "World / Afro / Latin",
  "soulful-house": "Soulful House",
  "soul-funk": "Soul / Funk",
  "broken-beat": "Broken Beat",
  "classical": "Classical / Score",
  "unknown": "Unclassified",
};

const INK = "#2b2724";
const PAPER = "#f4f1ea";
const MUTED = "#9a938a";

const gColor = (g) => GENRE_COLOR[g] || MUTED;

// Forza di coesione "a cluster": ogni tick spinge i nodi che condividono la
// stessa chiave (es. genere, oppure genere+artista) verso il loro centroide.
// Usata per compattare i cluster di genere e avvicinare i brani dello stesso
// autore all'interno del cluster.
function clusterForce(keyFn, strength) {
  let groups = [];
  function force(alpha) {
    const k = strength * alpha;
    for (const arr of groups) {
      if (arr.length < 2) continue;
      let cx = 0, cy = 0;
      for (const n of arr) { cx += n.x; cy += n.y; }
      cx /= arr.length; cy /= arr.length;
      for (const n of arr) { n.vx += (cx - n.x) * k; n.vy += (cy - n.y) * k; }
    }
  }
  force.initialize = (nodes) => {
    const m = new Map();
    for (const n of nodes) {
      const key = keyFn(n);
      let a = m.get(key);
      if (!a) m.set(key, (a = []));
      a.push(n);
    }
    groups = Array.from(m.values());
  };
  return force;
}

function MusicNetworkInner() {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const simRef = useRef(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
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

  // --- chat / playlist generata dal grafo ---
  const [playlist, setPlaylist] = useState(null); // array ordinato di id
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const routeRef = useRef([]); // datum dei nodi della playlist, per disegnare il percorso
  const playlistSet = useMemo(() => (playlist ? new Set(playlist) : null), [playlist]);

  // --- pesi dei legami, regolabili a mano (default dalla pipeline) ---
  const [weights, setWeights] = useState(
    () => (GRAPH.meta && GRAPH.meta.linkWeights) || DEFAULT_LINK_WEIGHTS
  );
  const [weightsOpen, setWeightsOpen] = useState(false);

  // --- ascolto continuo del percorso (mini-player persistente) ---
  const [playIndex, setPlayIndex] = useState(0);
  // ogni nuovo percorso riparte dal primo brano
  useEffect(() => { setPlayIndex(0); }, [playlist]);
  const playTracks = useMemo(
    () =>
      (playlist || [])
        .map((id) => GRAPH.nodes.find((n) => n.id === id))
        .filter(Boolean)
        .map((n) => ({ id: n.id, title: n.title, artist: n.artist })),
    [playlist]
  );

  // --- Spotify Connect (full-track opt-in) ---
  const [spotifyConnected, setSpotifyConnected] = useState(() => isSpotifyLoggedIn());
  useEffect(() => {
    let done = false;
    completeSpotifyAuthIfNeeded().then((ok) => {
      if (done || !ok) return;
      setSpotifyConnected(true);
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

  // Pre-carica l'API Spotify allo start: così l'autoplay del percorso parte
  // subito (controller pronto entro la finestra di user-activation del click).
  useEffect(() => { preloadSpotifyApi(); }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const nodes = GRAPH.nodes.map((d) => ({ ...d }));
    const links = GRAPH.links.map((d) => ({ ...d }));
    const nodesById = new Map(nodes.map((d) => [d.id, d]));
    const g = svg.append("g");

    const zoom = d3
      .zoom()
      .scaleExtent([0.12, 6])
      .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);
    svg.on("dblclick.zoom", null);

    const maxDeg = d3.max(nodes, (d) => d.degree) || 1;
    // Slightly larger nodes on phones so they're easier to tap accurately.
    const rScale = d3
      .scaleSqrt()
      .domain([1, maxDeg])
      .range(isMobile ? [5, 14] : [3, 12]);

    const link = g
      .append("g")
      .attr("stroke", INK)
      .attr("stroke-opacity", 0.1)
      // Links are visual only — never let them intercept pan/drag gestures.
      .style("pointer-events", "none")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", (d) => Math.min(2, 0.3 + d.weight * 0.1));

    // Percorso della playlist generata: una linea che collega i brani
    // nell'ordine d'ascolto. Disegnata sopra i link, sotto i nodi.
    const route = g
      .append("path")
      .attr("fill", "none")
      .attr("stroke", INK)
      .attr("stroke-opacity", 0)
      .attr("stroke-width", 2.2)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .style("pointer-events", "none");

    const drawRoute = () => {
      const pts = routeRef.current;
      if (!pts || pts.length < 2) {
        route.attr("d", null);
        return;
      }
      route.attr(
        "d",
        d3
          .line()
          .x((d) => d.x)
          .y((d) => d.y)
          .curve(d3.curveCatmullRom.alpha(0.5))(pts)
      );
    };

    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d) => rScale(d.degree))
      .attr("fill", (d) => gColor(d.genre))
      .attr("stroke", PAPER)
      .attr("stroke-width", 1.2)
      .style("cursor", "pointer")
      .call(
        d3
          .drag()
          .on("start", (e, d) => {
            if (!e.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (e, d) => {
            d.fx = e.x;
            d.fy = e.y;
          })
          .on("end", (e, d) => {
            if (!e.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    const labels = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .attr("font-size", 9)
      .attr("font-family", "'Spectral', Georgia, serif")
      .attr("fill", INK)
      .attr("dx", (d) => rScale(d.degree) + 3)
      .attr("dy", 3)
      .attr("opacity", 0)
      .style("pointer-events", "none");
    // Etichetta accanto al nodo: titolo + artista (artista in tono attenuato).
    labels.append("tspan").text((d) => d.title);
    labels.append("tspan").attr("fill", MUTED).text((d) => " — " + d.artist);

    node
      .on("mouseenter", (e, d) => setHovered(d))
      .on("mouseleave", () => setHovered(null))
      .on("click", (e, d) => {
        setSelected((prev) => (prev && prev.id === d.id ? null : d));
        e.stopPropagation();
      });
    svg.on("click", () => setSelected(null));

    // Genre clustering force — pulls same-genre nodes toward shared anchors,
    // giving spatial separation between genres on top of the link forces.
    const genres = GRAPH.genres;
    const angle = (gi) => (gi / genres.length) * 2 * Math.PI;
    const radius = Math.min(dims.w, dims.h) * 0.42;
    const anchor = (genre) => {
      const gi = genres.indexOf(genre);
      return {
        x: dims.w / 2 + radius * Math.cos(angle(gi)),
        y: dims.h / 2 + radius * Math.sin(angle(gi)),
      };
    };

    const sameGenre = (l) => l.source.genre === l.target.genre;

    const sim = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d) => d.id)
          // Stesso genere: legami piu' corti; generi diversi: piu' lunghi.
          .distance((d) => (55 / (0.4 + d.weight * 0.22)) * (sameGenre(d) ? 0.7 : 1.7))
          // Stesso genere: attrazione piu' forte; generi diversi: piu' debole.
          .strength((d) => Math.min(1, d.weight * 0.1) * (sameGenre(d) ? 1.6 : 0.35))
      )
      // Piu' repulsione generale: aiuta a separare i cluster di genere.
      .force("charge", d3.forceManyBody().strength(-44))
      // Ancore di genere piu' forti -> stesso genere piu' coeso, generi diversi piu' lontani.
      .force("x", d3.forceX((d) => anchor(d.genre).x).strength(0.13))
      .force("y", d3.forceY((d) => anchor(d.genre).y).strength(0.13))
      // Coesione esplicita: stesso genere si attrae; stesso autore (nello stesso
      // genere/cluster) si attrae di piu'.
      .force("genreCohesion", clusterForce((n) => n.genre, 0.06))
      .force("artistCohesion", clusterForce((n) => n.genre + "|" + n.artist, 0.5))
      .force(
        "collide",
        d3.forceCollide().radius((d) => rScale(d.degree) + 2)
      )
      .on("tick", () => {
        link
          .attr("x1", (d) => d.source.x)
          .attr("y1", (d) => d.source.y)
          .attr("x2", (d) => d.target.x)
          .attr("y2", (d) => d.target.y);
        node.attr("cx", (d) => d.x).attr("cy", (d) => d.y);
        labels.attr("x", (d) => d.x).attr("y", (d) => d.y);
        drawRoute();
      });

    simRef.current = { sim, node, link, labels, g, zoom, svg, anchor, route, nodesById, drawRoute };
    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!simRef.current) return;
    const { sim } = simRef.current;
    const genres = GRAPH.genres;
    const radius = Math.min(dims.w, dims.h) * 0.42;
    const angle = (gi) => (gi / genres.length) * 2 * Math.PI;
    sim
      .force(
        "x",
        d3
          .forceX((d) => {
            const gi = genres.indexOf(d.genre);
            return dims.w / 2 + radius * Math.cos(angle(gi));
          })
          .strength(0.13)
      )
      .force(
        "y",
        d3
          .forceY((d) => {
            const gi = genres.indexOf(d.genre);
            return dims.h / 2 + radius * Math.sin(angle(gi));
          })
          .strength(0.13)
      );
    sim.alpha(0.3).restart();
  }, [dims]);

  useEffect(() => {
    if (!simRef.current) return;
    const { node, link, labels } = simRef.current;
    const focus = selected || hovered;
    const focusId = focus?.id;
    const nbr = focusId ? neighbors.get(focusId) : null;

    const dim = (d) => {
      if (matchSet && !matchSet.has(d.id)) return true;
      if (activeGenre && d.genre !== activeGenre) return true;
      if (focusId && d.id !== focusId && !nbr?.has(d.id)) return true;
      if (!focusId && playlistSet && !playlistSet.has(d.id)) return true;
      return false;
    };

    node
      .attr("opacity", (d) => {
        if (focusId && d.id === focusId) return 1;
        if (!focusId && playlistSet?.has(d.id)) return 1;
        return dim(d) ? 0.08 : 0.96;
      })
      // Dimmed background nodes must not catch taps/drags: while a node is
      // focused (or a filter/playlist is active) only the highlighted layer
      // stays interactive, so a drag over the faded nodes pans/zooms the view
      // instead of grabbing a node underneath.
      .style("pointer-events", (d) => {
        if (focusId && d.id === focusId) return "auto";
        if (!focusId && playlistSet?.has(d.id)) return "auto";
        return dim(d) ? "none" : "auto";
      })
      .attr("stroke-width", (d) =>
        d.id === focusId || playlistSet?.has(d.id) ? 2.4 : matchSet?.has(d.id) ? 2 : 1.2
      )
      .attr("stroke", (d) =>
        d.id === focusId || matchSet?.has(d.id) || playlistSet?.has(d.id) ? INK : PAPER
      );

    link.attr("stroke-opacity", (d) => {
      const s = d.source.id ?? d.source;
      const t = d.target.id ?? d.target;
      if (focusId) return s === focusId || t === focusId ? 0.5 : 0.02;
      if (activeGenre) {
        const ns = GRAPH.nodes;
        return 0.04;
      }
      if (matchSet) return matchSet.has(s) || matchSet.has(t) ? 0.22 : 0.02;
      if (playlistSet) return playlistSet.has(s) && playlistSet.has(t) ? 0.15 : 0.02;
      return 0.1;
    });

    labels.attr("opacity", (d) => {
      if (focusId) {
        if (d.id === focusId) return 1;
        return nbr?.has(d.id) ? 0.8 : 0;
      }
      if (matchSet) return matchSet.has(d.id) ? 1 : 0;
      if (playlistSet) return playlistSet.has(d.id) ? 0.92 : 0;
      return 0;
    });

    // Nascondi il percorso della playlist mentre un nodo e' in focus (dettaglio).
    if (simRef.current.route) {
      const showRoute = !focusId && playlistSet && playlistSet.size > 1;
      simRef.current.route.attr("stroke-opacity", showRoute ? 0.5 : 0);
    }
  }, [selected, hovered, matchSet, activeGenre, neighbors, playlistSet]);

  // Aggiorna il percorso della playlist e inquadra i suoi nodi (solo al cambio).
  useEffect(() => {
    if (!simRef.current) return;
    const { nodesById, drawRoute, route, svg, zoom } = simRef.current;
    const pts = (playlist || []).map((id) => nodesById.get(id)).filter(Boolean);
    routeRef.current = pts;
    drawRoute();
    route.attr("stroke-opacity", pts.length > 1 ? 0.5 : 0);
    if (pts.length) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      // Inquadra nell'area utile, lasciando margini per header/legenda (sx, alto)
      // e per il pannello chat (basso): cosi i nodi non finiscono sotto la UI.
      // Su mobile la UI e' impilata in alto/in basso, quindi i margini cambiano.
      const Lm = isMobile ? 24 : Math.min(300, dims.w * 0.32);
      const Rm = isMobile ? 24 : 56;
      const Tm = isMobile ? 120 : 130;
      const Bm = isMobile ? Math.min(320, dims.h * 0.42) : Math.min(260, dims.h * 0.34);
      const uw = Math.max(120, dims.w - Lm - Rm);
      const uh = Math.max(120, dims.h - Tm - Bm);
      const bw = Math.max(60, maxX - minX);
      const bh = Math.max(60, maxY - minY);
      const k = Math.max(0.12, Math.min(2.0, Math.min(uw / (bw + 120), uh / (bh + 120))));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const t = d3.zoomIdentity
        .translate(Lm + uw / 2, Tm + uh / 2)
        .scale(k)
        .translate(-cx, -cy);
      svg.transition().duration(750).call(zoom.transform, t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist]);

  const resetView = useCallback(() => {
    if (!simRef.current) return;
    const { svg, zoom } = simRef.current;
    svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity);
    setSelected(null);
    setQuery("");
    setActiveGenre(null);
    setPlaylist(null);
  }, []);

  // --- chat: interpreta il messaggio e genera la playlist navigando il grafo ---
  const handleChat = useCallback((text) => {
    setChatInput("");
    const res = buildPlaylist(GRAPH, text, weights);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", res }]);
    setSelected(null);
    setActiveGenre(null);
    setQuery("");
    setPlaylist(res.ok && res.ids.length ? res.ids : null);
  }, [weights]);

  const pickTrack = useCallback((id) => {
    const n = GRAPH.nodes.find((x) => x.id === id);
    if (n) setSelected(n);
  }, []);

  // Genera una playlist usando il nodo selezionato come seed, seguendo le
  // connessioni del grafo. Chiude il dettaglio e mostra il risultato in chat.
  const generateFromNode = useCallback((node) => {
    if (!node) return;
    const res = buildFromSeed(GRAPH, node, 18, weights);
    setMessages((m) => [
      ...m,
      { role: "user", text: `playlist from "${node.title}"` },
      { role: "assistant", res },
    ]);
    setSelected(null);
    setActiveGenre(null);
    setQuery("");
    setChatOpen(true);
    setPlaylist(res.ok && res.ids.length ? res.ids : null);
  }, [weights]);

  const clearPlaylist = useCallback(() => setPlaylist(null), []);

  // --- export "senza setup": link Spotify esatti + CSV, poi Spotlistr/Spotify ---
  const sysMsg = useCallback((text, link, linkLabel) => {
    setMessages((m) => [...m, { role: "system", text, link, linkLabel }]);
    setChatOpen(true);
  }, []);

  const handleExport = useCallback(
    async (res) => {
      if (!res || !res.ok) return;
      // Apri Spotlistr subito: restando nel gesto del click si evita il popup-block.
      window.open(SPOTLISTR_URL, "_blank", "noopener");
      const links = playlistLinks(res);
      downloadFile(exportFilename(res, "csv"), playlistCsv(res), "text/csv;charset=utf-8");
      const copied = await copyText(links);
      sysMsg(
        `${res.tracks.length} tracks exported — Spotify links ${
          copied ? "copied to clipboard" : "in the downloaded CSV"
        } and CSV saved. Paste them into Spotlistr (opened in a new tab) to create the playlist, ` +
          `or paste the links into a Spotify desktop playlist.`,
        SPOTLISTR_URL,
        "Open Spotlistr ↗"
      );
    },
    [sysMsg]
  );

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

      {/* Header — container click-through; inputs re-enable events */}
      <div
        style={{
          position: "absolute",
          top: isMobile ? 12 : 28,
          left: isMobile ? 12 : 32,
          right: isMobile ? 12 : undefined,
          zIndex: 10,
          maxWidth: isMobile ? undefined : 360,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontFamily: "'Spectral', serif",
            fontSize: isMobile ? 22 : 30,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
          }}
        >
          New Release Atlas
        </div>
        {!isMobile && (
          <div
            style={{
              fontSize: 12,
              color: MUTED,
              marginTop: 6,
            }}
          >
            {meta.unique_tracks} tracks · {meta.edges} links · {orderedGenres.length}{" "}
            genres · playlists #12–#32
          </div>
        )}

        <div
          style={{
            marginTop: isMobile ? 10 : 18,
            display: "flex",
            gap: 8,
            pointerEvents: "auto",
            width: isMobile ? "100%" : "fit-content",
          }}
        >
          <input
            className="mn-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search track or artist…"
            style={{
              flex: 1,
              minWidth: 0,
              padding: isMobile ? "10px 12px" : "8px 12px",
              fontSize: 13,
              background: "rgba(255,255,255,0.6)",
              border: `1px solid ${MUTED}`,
              borderRadius: 2,
              color: INK,
              transition: "border-color 0.2s",
            }}
          />
          {isMobile && (
            <button
              onClick={() => setLegendOpen((v) => !v)}
              aria-label="Toggle genre filter"
              style={{
                padding: "10px 12px",
                fontSize: 12,
                background: legendOpen ? "rgba(255,255,255,0.85)" : "transparent",
                border: `1px solid ${MUTED}`,
                borderRadius: 2,
                color: INK,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              ⦿ Genres
            </button>
          )}
          <button
            onClick={resetView}
            style={{
              padding: isMobile ? "10px 14px" : "8px 14px",
              fontSize: 12,
              background: "transparent",
              border: `1px solid ${MUTED}`,
              borderRadius: 2,
              color: INK,
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Genre legend / filter — container is click-through; only rows catch clicks.
          On mobile it's a toggleable card so it doesn't bury the map. */}
      {showLegend && (
      <div
        style={{
          position: "absolute",
          top: isMobile ? 92 : 150,
          left: isMobile ? 12 : 32,
          right: isMobile ? 12 : undefined,
          zIndex: 10,
          width: isMobile ? "auto" : "fit-content",
          maxWidth: isMobile ? undefined : 220,
          maxHeight: isMobile ? "52dvh" : undefined,
          overflowY: isMobile ? "auto" : undefined,
          pointerEvents: isMobile ? "auto" : "none",
          background: isMobile ? "rgba(255,255,255,0.95)" : "transparent",
          backdropFilter: isMobile ? "blur(8px)" : undefined,
          border: isMobile ? `1px solid ${MUTED}` : undefined,
          borderRadius: isMobile ? 6 : undefined,
          padding: isMobile ? "10px 12px" : undefined,
          boxShadow: isMobile ? "0 10px 30px rgba(0,0,0,0.12)" : undefined,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: MUTED,
            marginBottom: 8,
          }}
        >
          Genres — {isMobile ? "tap" : "click"} to filter
        </div>
        {orderedGenres.map((g) => {
          const active = activeGenre === g;
          return (
            <div
              key={g}
              className="mn-chip"
              onClick={() => setActiveGenre(active ? null : g)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: isMobile ? "8px 8px" : "3px 6px",
                marginBottom: 1,
                width: isMobile ? "100%" : "fit-content",
                cursor: "pointer",
                pointerEvents: "auto",
                borderRadius: 2,
                background: active ? "rgba(255,255,255,0.7)" : "transparent",
                opacity: activeGenre && !active ? 0.4 : 1,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: gColor(g),
                  flexShrink: 0,
                  border: active ? `1.5px solid ${INK}` : "none",
                }}
              />
              <span style={{ fontSize: isMobile ? 13 : 12, minWidth: isMobile ? 0 : 120, flex: isMobile ? 1 : undefined }}>{GENRE_LABEL[g] || g}</span>
              <span style={{ fontSize: 11, color: MUTED, marginLeft: "auto" }}>
                {genreCounts[g]}
              </span>
            </div>
          );
        })}
      </div>
      )}

      {!isMobile && (
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 32,
          zIndex: 10,
          fontSize: 11,
          color: MUTED,
          lineHeight: 1.6,
        }}
      >
        Click a node to isolate its links · drag to reposition
        <br />
        scroll to zoom · clusters are the inferred genres
      </div>
      )}

      <div ref={wrapRef} style={{ position: "absolute", inset: 0, zIndex: 2 }}>
        <svg
          ref={svgRef}
          width={dims.w}
          height={dims.h}
          style={{
            display: "block",
            // Let d3-zoom own all touch gestures (pinch to zoom, drag to pan)
            // instead of the browser scrolling/zooming the page.
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        />
      </div>

      {/* Detail panel — a docked card on desktop, a bottom sheet on mobile. */}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: isMobile ? undefined : 28,
            right: isMobile ? 0 : 28,
            bottom: isMobile ? 0 : undefined,
            left: isMobile ? 0 : undefined,
            zIndex: 40,
            width: isMobile ? "auto" : 340,
            maxWidth: isMobile ? undefined : "calc(100vw - 56px)",
            boxSizing: "border-box",
            maxHeight: isMobile ? "70dvh" : undefined,
            overflowY: isMobile ? "auto" : undefined,
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "blur(8px)",
            border: `1px solid ${MUTED}`,
            borderRadius: isMobile ? "14px 14px 0 0" : 3,
            padding: isMobile ? "18px 20px calc(20px + env(safe-area-inset-bottom))" : "20px 22px",
            boxShadow: isMobile ? "0 -8px 30px rgba(0,0,0,0.16)" : "0 8px 30px rgba(0,0,0,0.08)",
          }}
        >
          <button
            onClick={() => setSelected(null)}
            aria-label="Close"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 30,
              height: 30,
              lineHeight: "28px",
              textAlign: "center",
              fontSize: 15,
              background: "transparent",
              border: `1px solid rgba(154,147,138,0.5)`,
              borderRadius: "50%",
              color: MUTED,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", paddingRight: 34 }}>
            {selected.genres.map((g) => (
              <span
                key={g}
                style={{
                  fontSize: 10,
                  padding: "2px 8px",
                  borderRadius: 10,
                  background: gColor(g),
                  color: "#fff",
                  letterSpacing: "0.02em",
                }}
              >
                {GENRE_LABEL[g] || g}
              </span>
            ))}
          </div>
          <div
            style={{
              fontFamily: "'Spectral', serif",
              fontSize: 19,
              fontWeight: 500,
              lineHeight: 1.2,
            }}
          >
            {selected.title}
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>
            {selected.artists.join(", ")}
          </div>
          <div
            style={{
              fontSize: 11,
              color: MUTED,
              marginTop: 14,
              lineHeight: 1.7,
            }}
          >
            Duration {selected.duration} · {selected.degree} links
            <br />
            Playlists {selected.playlists.map((p) => "#" + p).join(", ")}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <a
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 12,
                color: PAPER,
                background: INK,
                padding: "7px 14px",
                borderRadius: 2,
                textDecoration: "none",
              }}
            >
              Open in Spotify ↗
            </a>
            <button
              onClick={() => generateFromNode(selected)}
              title="Build a playlist from this track's graph connections"
              style={{
                fontSize: 12,
                color: INK,
                background: "transparent",
                border: `1px solid ${INK}`,
                padding: "7px 14px",
                borderRadius: 2,
                cursor: "pointer",
              }}
            >
              ♫ Generate playlist
            </button>
            <button
              onClick={() => setWeightsOpen((v) => !v)}
              title="Regola i pesi dei legami usati per costruire il percorso"
              style={{
                fontSize: 12, color: INK, background: weightsOpen ? "rgba(43,39,36,0.08)" : "transparent",
                border: `1px solid ${MUTED}`, padding: "7px 12px", borderRadius: 2, cursor: "pointer",
              }}
            >
              ⚖ pesi
            </button>
          </div>

          {weightsOpen && (
            <WeightControls weights={weights} setWeights={setWeights} />
          )}
          {/* Player Spotify del singolo brano (anteprima ~30s per tutti, brano
              intero per Premium loggato). Nascosto se c'è un percorso in
              ascolto: in quel caso suona il mini-player del percorso (no doppio audio). */}
          {!playlist && (
            <iframe
              title="Spotify player"
              src={`https://open.spotify.com/embed/track/${selected.id}?utm_source=new-release-atlas`}
              width="100%"
              height="80"
              frameBorder="0"
              loading="lazy"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              style={{ border: 0, borderRadius: 8, marginTop: 16, display: "block" }}
            />
          )}
        </div>
      )}

      {!isMobile && hovered && !selected && (
        <div
          style={{
            position: "absolute",
            bottom: 24,
            right: 28,
            zIndex: 15,
            background: "rgba(43,39,36,0.92)",
            color: PAPER,
            padding: "8px 14px",
            borderRadius: 2,
            fontSize: 12,
            maxWidth: 260,
          }}
        >
          <span style={{ fontFamily: "'Spectral', serif", fontWeight: 500 }}>
            {hovered.title}
          </span>
          <span style={{ opacity: 0.7 }}> — {hovered.artist}</span>
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 10,
              color: gColor(hovered.genre),
            }}
          >
            ● {GENRE_LABEL[hovered.genre] || hovered.genre}
          </span>
        </div>
      )}

      <Chat
        open={chatOpen}
        setOpen={setChatOpen}
        messages={messages}
        value={chatInput}
        onChange={setChatInput}
        onSubmit={handleChat}
        onClear={clearPlaylist}
        onPick={pickTrack}
        onExport={handleExport}
        genreColor={gColor}
        hasPlaylist={!!playlist}
        bottomOffset={playTracks.length ? 132 : 0}
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
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

// Slider per i pesi dei legami usati nella costruzione del percorso.
// Gerarchia di default: genere primario > artista > genere secondario > playlist.
function WeightControls({ weights, setWeights }) {
  const rows = [
    ["primary", "Genere primario"],
    ["artist", "Artista"],
    ["secondary", "Genere secondario"],
    ["playlist", "Stessa playlist"],
  ];
  const set = (k, v) => setWeights((w) => ({ ...w, [k]: v }));
  return (
    <div style={{ marginTop: 12, padding: "10px 12px", background: "rgba(43,39,36,0.04)", borderRadius: 4 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
        <span>Pesi dei legami</span>
        <span onClick={() => setWeights({ ...DEFAULT_LINK_WEIGHTS })} style={{ cursor: "pointer", textDecoration: "underline" }}>ripristina</span>
      </div>
      {rows.map(([k, label]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, margin: "5px 0" }}>
          <span style={{ fontSize: 11, width: 118 }}>{label}</span>
          <input
            type="range" min="0" max="5" step="0.1" value={weights[k] ?? 0}
            onChange={(e) => set(k, parseFloat(e.target.value))} style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, width: 26, textAlign: "right", color: MUTED }}>{(weights[k] ?? 0).toFixed(1)}</span>
        </div>
      ))}
      <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
        Premi “♫ Generate playlist” per applicare i pesi.
      </div>
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
        GRAPH = data;
        setReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return (
      <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#c75b4a" }}>
        Errore nel caricamento di graph.json: {error}
      </div>
    );
  if (!ready)
    return (
      <div style={{ padding: 40, fontFamily: "Inter, sans-serif", color: "#9a938a" }}>
        Caricamento della mappa…
      </div>
    );
  return <MusicNetworkInner />;
}
