import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import Chat from "./Chat.jsx";
import PlayerBar, { preloadSpotifyApi } from "./PlayerBar.jsx";
import {
  completeSpotifyAuthIfNeeded, isSpotifyLoggedIn, loginSpotify, setPendingPlay, takePendingPlay,
} from "./spotifyConnect.js";
import { buildPlaylist, buildFromSeed, DEFAULT_LINK_WEIGHTS, DEFAULT_RANDOMNESS, DEFAULT_MOOD } from "./playlist.js";
import {
  SPOTLISTR_URL, playlistLinks, playlistCsv, exportFilename, copyText, downloadFile,
} from "./export.js";
import { INK, PAPER, MUTED, ACCENT, gColor } from "./theme.js";
import { hydrateGraph } from "./graph/hydrate.js";
import { clusterForce, hashJitter, packGenreAnchors } from "./graph/layout.js";
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

function MusicNetworkInner() {
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const simRef = useRef(null);
  const hoverElsRef = useRef(null); // elementi evidenziati dall'hover corrente
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
  // fonte dell'ultima playlist generata (testo chat o brano-seed): serve per
  // rigenerarla con nuovi pesi/mood quando l'utente cambia i parametri.
  const lastGenRef = useRef(null);
  const playlistSet = useMemo(() => (playlist ? new Set(playlist) : null), [playlist]);

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
  const [weightsOpen, setWeightsOpen] = useState(false);
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
    // Su mobile la tela e' stretta: nodi PIU' PICCOLI (non piu' grandi) cosi'
    // l'area totale dei pallini sta nel canvas e resta spazio VUOTO fra le isole
    // di genere. Nodi grandi su schermo piccolo facevano collassare i cluster in
    // un'unica massa (la collisione vinceva sulle ancore).
    const rScale = d3
      .scaleSqrt()
      .domain([1, maxDeg])
      .range(isMobile ? [3, 8] : [3, 12]);

    const link = g
      .append("g")
      .attr("class", "mn-linkg")
      .attr("stroke", INK)
      .attr("stroke-opacity", 0.1)
      // Links are visual only — never let them intercept pan/drag gestures.
      .style("pointer-events", "none")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke-width", (d) => Math.min(2, 0.3 + d.weight * 0.1));

    // Percorso della playlist generata: segmenti che collegano i brani
    // nell'ordine d'ascolto. Disegnati sopra i link, sotto i nodi. Si
    // assottigliano e sfumano dal primo all'ultimo brano, così la direzione
    // del percorso è leggibile a colpo d'occhio.
    const route = g
      .append("g")
      .attr("class", "mn-route")
      .attr("fill", "none")
      .attr("stroke", ACCENT)
      .attr("stroke-linecap", "round")
      .style("pointer-events", "none");

    const drawRoute = () => {
      const pts = routeRef.current;
      const n = pts ? pts.length : 0;
      const segs = n >= 2 ? d3.range(n - 1) : [];
      const denom = Math.max(1, n - 2);
      const seg = route.selectAll("line").data(segs);
      seg.exit().remove();
      seg
        .enter()
        .append("line")
        .merge(seg)
        .attr("x1", (i) => pts[i].x)
        .attr("y1", (i) => pts[i].y)
        .attr("x2", (i) => pts[i + 1].x)
        .attr("y2", (i) => pts[i + 1].y)
        // primo brano: tratto spesso e marcato → ultimo: sottile e sfumato
        .attr("stroke-width", (i) => 3.6 - 2.6 * (i / denom))
        .attr("stroke-opacity", (i) => 0.95 - 0.62 * (i / denom));
    };

    const node = g
      .append("g")
      .attr("class", "mn-nodeg")
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
      .attr("class", "mn-labelg")
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

    // Hover solo dove esiste davvero (mouse/trackpad): su touch il mouseenter
    // sintetico del tap farebbe un restyle inutile prima di ogni click.
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    node
      .on("mouseenter", canHover ? (e, d) => setHovered(d) : null)
      .on("mouseleave", canHover ? () => setHovered(null) : null)
      .on("click", (e, d) => {
        setSelected((prev) => (prev && prev.id === d.id ? null : d));
        e.stopPropagation();
      });
    svg.on("click", () => setSelected(null));

    // Genre clustering force — pulls same-genre nodes toward shared anchors,
    // giving spatial separation between genres on top of the link forces.
    // Ancore impacchettate proporzionalmente alla dimensione (riempimento omogeneo).
    const genres = GRAPH.genres;
    let anchorMap = packGenreAnchors(genres, genreCounts, dims);
    const anchor = (genre) => anchorMap.get(genre) || { x: dims.w / 2, y: dims.h / 2 };

    const sameGenre = (l) => l.source.genre === l.target.genre;

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
          .strength((d) => Math.min(1, d.weight * 0.1) * (sameGenre(d) ? 1.6 : 0.12))
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
      .force("artistCohesion", clusterForce((n) => n.genre + "|" + n.artist, 0.15))
      // Collisione = leva per separare i nodi densi senza "aprire" il cluster
      // (link e coesione lo tengono comunque unito). Padding piccolo (mobile 0.5,
      // desktop 1.5) -> blob COMPATTI cosi' le isole di genere restano staccate;
      // il jitter sul raggio resta alto (dischi disuguali) per rompere il
      // reticolo esagonale. strength/iterations alti fanno rispettare la spaziatura.
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d) => rScale(d.degree) + (isMobile ? 0.5 : 1.5) + hashJitter(d.id) * (isMobile ? 1 : 4))
          // strength 1 + 3 iterazioni: la spaziatura minima e' sempre rispettata,
          // i pallini non si sovrappongono mai nemmeno sotto la spinta delle ancore.
          .strength(1)
          .iterations(3)
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

    // Mappa id -> elementi <line> incidenti: l'hover evidenzia solo i ~deg
    // archi del nodo (via classi CSS) invece di ristilizzare tutti i 7k link.
    const incident = new Map();
    link.each(function (l) {
      const s = l.source.id ?? l.source;
      const t = l.target.id ?? l.target;
      if (!incident.has(s)) incident.set(s, []);
      if (!incident.has(t)) incident.set(t, []);
      incident.get(s).push(this);
      incident.get(t).push(this);
    });

    simRef.current = { sim, node, link, labels, g, zoom, svg, anchor, route, nodesById, drawRoute, incident };
    return () => sim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!simRef.current) return;
    const { sim } = simRef.current;
    // Ricalcola le ancore impacchettate per le nuove dimensioni (init e resize
    // condividono la stessa geometria proporzionale alla dimensione dei cluster).
    const anchorMap = packGenreAnchors(GRAPH.genres, genreCounts, dims);
    const at = (d) => anchorMap.get(d.genre) || { x: dims.w / 2, y: dims.h / 2 };
    sim
      .force("x", d3.forceX((d) => at(d).x).strength(0.26))
      .force("y", d3.forceY((d) => at(d).y).strength(0.26));
    sim.alpha(0.3).restart();
  }, [dims, genreCounts]);

  // Restyle "strutturale" (selezione, filtri, ricerca, playlist): tocca tutti
  // gli elementi, quindi NON dipende dall'hover — quello e' gestito a parte con
  // classi CSS (effetto leggero qui sotto) per non ristilizzare 7k archi a
  // ogni passaggio del mouse.
  useEffect(() => {
    if (!simRef.current) return;
    const { node, link, labels } = simRef.current;
    const focus = selected;
    const focusId = focus?.id;
    const selId = selected?.id; // solo il brano cliccato pulsa (non l'hover)
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

    node
      .attr("opacity", (d) => {
        if (focusId && d.id === focusId) return 1;
        if (!focusId && playlistSet?.has(d.id)) return 1;
        return dim(d) ? 0.08 : 0.96;
      })
      // Dimmed background nodes must not catch taps/drags: while a node is
      // focused (or a filter/playlist is active) only the highlighted layer
      // stays interactive, so a drag over the faded nodes pans/zooms the view
      // instead of grabbing a node underneath. Attributo (non style inline):
      // le regole CSS .mn-hover devono poterlo sovrascrivere durante l'hover.
      .attr("pointer-events", (d) => {
        if (focusId && d.id === focusId) return "auto";
        if (!focusId && playlistSet?.has(d.id)) return "auto";
        return dim(d) ? "none" : "auto";
      })
      .attr("stroke-width", (d) =>
        d.id === currentId ? 3 : d.id === focusId || playlistSet?.has(d.id) ? 2.4 : matchSet?.has(d.id) ? 2 : 1.2
      )
      .attr("stroke", (d) =>
        d.id === selId || d.id === currentId
          ? ACCENT
          : d.id === focusId || matchSet?.has(d.id) || playlistSet?.has(d.id)
          ? INK
          : PAPER
      );
    // Alone ciano statico: sul brano selezionato e su quello in riproduzione.
    node.classed("mn-node-selected", (d) => d.id === selId);
    node.classed("mn-node-playing", (d) => d.id === currentId);

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
      simRef.current.route.attr("display", showRoute ? null : "none");
    }
  }, [selected, matchSet, activeGenre, neighbors, playlistSet, playlist, playIndex]);

  // Effetto LEGGERO per l'hover: aggiunge/toglie classi solo sul nodo, i suoi
  // vicini, le sue etichette e i suoi ~deg archi incidenti; il resto della
  // scena sfuma via regole CSS scoped sotto .mn-hover (che sovrascrivono gli
  // attributi di base impostati dall'effetto strutturale). Costo per hover:
  // O(grado del nodo) mutazioni DOM invece di ~8k.
  useEffect(() => {
    if (!simRef.current) return;
    const { g, node, labels, incident } = simRef.current;
    if (hoverElsRef.current) {
      for (const el of hoverElsRef.current) el.classList.remove("mn-hl", "mn-hl-n");
      hoverElsRef.current = null;
    }
    const id = !selected && hovered ? hovered.id : null;
    g.classed("mn-hover", !!id);
    if (!id) return;
    const nbr = neighbors.get(id) || new Set();
    const els = [];
    const mark = function (d) {
      if (d.id === id) { this.classList.add("mn-hl"); els.push(this); }
      else if (nbr.has(d.id)) { this.classList.add("mn-hl-n"); els.push(this); }
    };
    node.each(mark);
    labels.each(mark);
    for (const el of incident.get(id) || []) { el.classList.add("mn-hl"); els.push(el); }
    hoverElsRef.current = els;
  }, [hovered, selected, neighbors]);

  // Aggiorna il percorso della playlist e inquadra i suoi nodi (solo al cambio).
  useEffect(() => {
    if (!simRef.current) return;
    const { nodesById, drawRoute, route, svg, zoom } = simRef.current;
    const pts = (playlist || []).map((id) => nodesById.get(id)).filter(Boolean);
    routeRef.current = pts;
    drawRoute();
    route.attr("display", pts.length > 1 ? null : "none");
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
    const res = buildPlaylist(GRAPH, text, weights, randomness, mood);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", res }]);
    setSelected(null);
    setActiveGenre(null);
    setQuery("");
    if (res.ok && res.ids.length) lastGenRef.current = { kind: "chat", text };
    setPlaylist(res.ok && res.ids.length ? res.ids : null);
  }, [weights, randomness, mood]);

  const pickTrack = useCallback((id) => {
    const n = GRAPH.nodes.find((x) => x.id === id);
    if (n) setSelected(n);
  }, []);

  // Ri-attiva una playlist generata (dal tasto "▶ Play" nella chat): rimostra
  // route + player anche dopo un Reset o la chiusura del player.
  const onPlayResult = useCallback((ids) => {
    if (ids && ids.length) setPlaylist([...ids]);
  }, []);

  // Dal mini-player: apre il dettaglio del brano e centra il nodo sulla mappa.
  const onOpenTrack = useCallback((id) => {
    const n = GRAPH.nodes.find((x) => x.id === id);
    if (!n) return;
    setSelected(n);
    const S = simRef.current;
    const nd = S && S.nodesById.get(id);
    if (nd && nd.x != null) {
      const t = d3.zoomIdentity.translate(dims.w / 2, dims.h / 2).scale(1.5).translate(-nd.x, -nd.y);
      S.svg.transition().duration(600).call(S.zoom.transform, t);
    }
  }, [dims]);


  // Genera una playlist usando il nodo selezionato come seed, seguendo le
  // connessioni del grafo. Chiude il dettaglio e mostra il risultato in chat.
  const generateFromNode = useCallback((node) => {
    if (!node) return;
    const res = buildFromSeed(GRAPH, node, 18, weights, randomness, mood);
    setMessages((m) => [
      ...m,
      { role: "user", text: `playlist from "${node.title}"` },
      { role: "assistant", res },
    ]);
    setSelected(null);
    setActiveGenre(null);
    setQuery("");
    setChatOpen(true);
    if (res.ok && res.ids.length) lastGenRef.current = { kind: "seed", node, size: 18 };
    setPlaylist(res.ok && res.ids.length ? res.ids : null);
  }, [weights, randomness, mood]);

  const clearPlaylist = useCallback(() => setPlaylist(null), []);

  // Rigenera la playlist attiva a partire dalla stessa richiesta (testo chat o
  // brano-seed) con i valori CORRENTI di pesi/varietà/mood. Aggiorna anche
  // l'ultima risposta in chat per restare coerente. È il "Regenerate" manuale.
  const regenerateFromLast = useCallback(() => {
    const lg = lastGenRef.current;
    if (!playlist || !lg) return;
    const res =
      lg.kind === "seed"
        ? buildFromSeed(GRAPH, lg.node, lg.size || 18, weights, randomness, mood)
        : buildPlaylist(GRAPH, lg.text, weights, randomness, mood);
    if (!res.ok || !res.ids.length) return;
    setPlaylist(res.ids);
    setMessages((msgs) => {
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          const copy = msgs.slice();
          copy[i] = { ...copy[i], res };
          return copy;
        }
      }
      return msgs;
    });
  }, [playlist, weights, randomness, mood]);

  // Comportamento "legacy" (liveRegen ON): al cambio dei parametri rigenera al
  // volo, con debounce (non ad ogni scatto dello slider ma quando ci si ferma).
  // Default OFF: non fa nulla, la rigenerazione avviene solo con "Regenerate".
  useEffect(() => {
    if (!liveRegen) return;
    const t = setTimeout(regenerateFromLast, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weights, randomness, mood, liveRegen]);

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
        /* Brano selezionato: alone ciano STATICO (niente animazione). Un filter
           animato su un elemento SVG forza repaint continui dell'intera tela e fa
           sfarfallare i pannelli con backdrop-filter: il glow fisso viene dipinto
           una sola volta alla selezione, quindi nessun repaint in loop. */
        .mn-node-selected, .mn-node-playing {
          stroke-width: 3.5px;
          filter: drop-shadow(0 0 9px rgba(31,182,232,0.95));
        }
        /* Percorso della playlist: linea azzurra brillante con leggero bagliore. */
        .mn-route { filter: drop-shadow(0 0 4px rgba(31,182,232,0.7)); }
        /* Hover di un nodo: il nodo + vicini + archi incidenti ricevono classi
           (.mn-hl / .mn-hl-n, costo O(grado)); tutto il resto sfuma con queste
           regole, che sovrascrivono gli attributi di base della scena. */
        .mn-hover .mn-nodeg circle { opacity: 0.08; pointer-events: none; }
        .mn-hover .mn-nodeg circle.mn-hl-n { opacity: 0.96; pointer-events: auto; }
        .mn-hover .mn-nodeg circle.mn-hl {
          opacity: 1; pointer-events: auto;
          stroke: #2b2724; stroke-width: 2.4px;
        }
        .mn-hover .mn-linkg line { stroke-opacity: 0.02; }
        .mn-hover .mn-linkg line.mn-hl { stroke-opacity: 0.5; }
        .mn-hover .mn-labelg text { opacity: 0; }
        .mn-hover .mn-labelg text.mn-hl-n { opacity: 0.8; }
        .mn-hover .mn-labelg text.mn-hl { opacity: 1; }
        .mn-hover .mn-route { display: none; }
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

      {selected && (
        <DetailPanel
          track={selected}
          onClose={() => setSelected(null)}
          isMobile={isMobile}
          reserveBottom={playTracks.length ? playerH + 36 : 20}
          moodOpen={moodOpen} setMoodOpen={setMoodOpen}
          weightsOpen={weightsOpen} setWeightsOpen={setWeightsOpen}
          onGenerate={generateFromNode}
          showEmbed={!playlist}
          weights={weights} setWeights={setWeights}
          randomness={randomness} setRandomness={setRandomness}
          mood={mood} setMood={setMood}
          liveRegen={liveRegen} setLiveRegen={setLiveRegen}
          onRegenerate={regenerateFromLast} canRegenerate={!!playlist}
        />
      )}

      {!isMobile && hovered && !selected && <HoverCard track={hovered} />}

      <Chat
        open={chatOpen}
        setOpen={setChatOpen}
        messages={messages}
        value={chatInput}
        onChange={setChatInput}
        onSubmit={handleChat}
        onPick={pickTrack}
        onPlay={onPlayResult}
        onExport={handleExport}
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
        onRegenerate={regenerateFromLast}
        canRegenerate={!!playlist}
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
