import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import * as d3 from "d3";
import Chat from "./Chat.jsx";
import { buildPlaylist, buildFromSeed } from "./playlist.js";
import {
  SPOTLISTR_URL, playlistLinks, playlistCsv, exportFilename, copyText, downloadFile,
} from "./export.js";

/* ================================================================
   New Release Atlas v3 — CLASSIFICAZIONE + RETE
   ----------------------------------------------------------------
   La mappa non e' piu' un force-graph "a gomitolo": e' un atlante a
   cerchi annidati (circle-packing) che rende esplicita la gerarchia
        Archivio > Genere > Artista > Brano
   Ogni genere e' un territorio, dentro stanno gli artisti, e i brani
   sono i punti-dato (raggio proporzionale a sqrt(degree)).

   Sopra la classificazione vive la RETE: selezionando un brano emergono
   i suoi legami (artista / genere / co-playlist condivisi) verso gli
   altri brani dell'archivio; cliccando un brano connesso si naviga di
   nodo in nodo. La playlist generata dalla chat viene disegnata come
   PERCORSO D'ASCOLTO ordinato sullo stesso strato.

   Dati: caricati a runtime via fetch da graph.json (vedi loader in fondo).
   ================================================================ */

let GRAPH = null; // popolato dal loader prima del mount di MusicNetworkInner

// Palette editoriale per genere (un colore per genere, tono attenuato).
const GENRE_COLOR = {
  "neo-soul": "#c75b4a", "electronic": "#3a7d8c", "jazz": "#d39a3e",
  "alt": "#8a6d9e", "uk-jazz": "#6b8e5a", "hip-hop": "#b5697e",
  "world": "#bf8b4a", "soulful-house": "#4f9e9e", "soul-funk": "#9e6b52",
  "broken-beat": "#7d8c4f", "classical": "#7a8aa0", "unknown": "#b8b0a4",
};
const GENRE_LABEL = {
  "neo-soul": "Neo-Soul / R&B", "electronic": "Electronic", "jazz": "Jazz",
  "alt": "Alt / Indie", "uk-jazz": "UK Jazz", "hip-hop": "Hip-Hop",
  "world": "World / Afro / Latin", "soulful-house": "Soulful House",
  "soul-funk": "Soul / Funk", "broken-beat": "Broken Beat",
  "classical": "Classical / Score", "unknown": "Non classificato",
};

const PAPER = "#f4f1ea";
const PAPER_DK = "#ece7dc";
const INK = "#2b2724";
const MUTED = "#9a938a";
const DIA = 1040; // lato del quadrato virtuale di layout

const norm = (s) => (s || "").toLowerCase();
const gcol = (g) => GENRE_COLOR[g] || MUTED;

// Relazione "umana" tra due brani, per etichettare i legami della rete.
function relation(a, b) {
  const aa = a.artists || [a.artist];
  const ba = b.artists || [b.artist];
  if (aa.some((x) => ba.includes(x))) return { kind: "artist", label: "stesso artista" };
  if (a.genre === b.genre) return { kind: "genre", label: GENRE_LABEL[a.genre] || a.genre };
  const sg = (a.genres || []).find((x) => (b.genres || []).includes(x));
  if (sg) return { kind: "genre", label: GENRE_LABEL[sg] || sg };
  return { kind: "playlist", label: "affinità / playlist" };
}

function MusicNetworkInner() {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const vizRef = useRef(null);
  const selIdRef = useRef(null); // id del brano selezionato (per i listener d3)

  const [selected, setSelected] = useState(null); // nodo brano (campi reali del grafo)
  const [path, setPath] = useState([]);            // breadcrumb
  const [query, setQuery] = useState("");
  const [indexOpen, setIndexOpen] = useState(false);
  const [dims, setDims] = useState({ w: 1200, h: 800 });
  const isMobile = dims.w <= 720;

  // chat / playlist generata dal grafo
  const [playlist, setPlaylist] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  const dataById = useMemo(() => {
    const m = new Map();
    GRAPH.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, []);

  // adiacenza: id -> [{id, w}] ordinata per peso decrescente
  const neighborMap = useMemo(() => {
    const m = new Map();
    GRAPH.nodes.forEach((n) => m.set(n.id, []));
    GRAPH.links.forEach((l) => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      const w = l.weight || 1;
      m.get(s)?.push({ id: t, w });
      m.get(t)?.push({ id: s, w });
    });
    m.forEach((arr) => arr.sort((x, y) => y.w - x.w));
    return m;
  }, []);

  const hierarchy = useMemo(() => {
    const present = GRAPH.genres.filter((g) => GRAPH.nodes.some((n) => n.genre === g));
    const byGenre = d3.group(GRAPH.nodes, (n) => n.genre);
    const children = present.map((g) => {
      const tracks = byGenre.get(g) || [];
      const byArtist = d3.group(tracks, (n) => n.artist);
      const artists = Array.from(byArtist, ([artist, ts]) => ({
        type: "artist", name: artist, gname: g,
        children: ts
          .slice().sort((a, b) => d3.ascending(a.title, b.title))
          .map((n) => ({ type: "track", name: n.title, gname: g, track: n })),
      })).sort((a, b) => b.children.length - a.children.length || d3.ascending(a.name, b.name));
      return { type: "genre", name: g, gname: g, children: artists };
    });
    return { type: "root", name: "Archivio", children };
  }, []);

  const genreCounts = useMemo(() => {
    const c = {};
    GRAPH.nodes.forEach((n) => (c[n.genre] = (c[n.genre] || 0) + 1));
    return c;
  }, []);
  const orderedGenres = useMemo(
    () => GRAPH.genres.filter((g) => genreCounts[g]), [genreCounts]
  );
  const genreNum = useMemo(() => {
    const m = {};
    orderedGenres.forEach((g, i) => (m[g] = String(i + 1).padStart(2, "0")));
    return m;
  }, [orderedGenres]);
  const totalArtists = useMemo(() => new Set(GRAPH.nodes.map((n) => n.artist)).size, []);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ================================================================
  //  Costruzione: packing (classificazione) + overlay (rete/percorso)
  // ================================================================
  useEffect(() => {
    const root = d3
      .pack().size([DIA, DIA])
      .padding((d) => (d.depth === 1 ? 11 : d.depth === 2 ? 3 : 1))(
      d3.hierarchy(hierarchy)
        .sum((d) => (d.type === "track" ? 1 + Math.sqrt(d.track.degree || 1) : 0))
        .sort((a, b) => (b.value || 0) - (a.value || 0))
    );

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", [-DIA / 2, -DIA / 2, DIA, DIA].join(" "));

    const descendants = root.descendants();
    const leafById = new Map();
    descendants.forEach((d) => {
      if (d.data.type === "track") leafById.set(d.data.track.id, d);
    });

    // ---- strato cerchi (classificazione) ----
    const node = svg.append("g").selectAll("circle")
      .data(descendants.slice(1)).join("circle")
      .attr("data-type", (d) => d.data.type)
      .attr("fill", (d) =>
        d.data.type === "track" ? gcol(d.data.gname)
        : d.data.type === "artist" ? PAPER_DK
        : d3.color(gcol(d.data.gname)).copy({ opacity: 0.07 })
      )
      .attr("stroke", (d) =>
        d.data.type === "genre" ? gcol(d.data.gname)
        : d.data.type === "artist" ? "rgba(43,39,36,0.10)" : PAPER
      )
      .attr("stroke-width", (d) =>
        d.data.type === "genre" ? 1.1 : d.data.type === "artist" ? 0.8 : 0.6
      )
      .style("cursor", "pointer")
      .style("opacity", 0)
      .on("click", (e, d) => {
        e.stopPropagation();
        if (d.data.type === "track") selectTrack(d.data.track, d);
        else zoomTo(d);
      });

    // ---- strato etichette ----
    const label = svg.append("g")
      .style("pointer-events", "none")
      .attr("text-anchor", "middle")
      .selectAll("text").data(descendants).join("text")
      .attr("fill", INK)
      .style("font-family", (d) =>
        d.data.type === "genre" ? "'Spectral', Georgia, serif" : "'IBM Plex Mono', monospace"
      )
      .style("font-weight", (d) => (d.data.type === "genre" ? 500 : 400))
      .style("font-size", (d) =>
        d.data.type === "genre" ? "19px" : d.data.type === "artist" ? "10px" : "8px"
      )
      .style("fill-opacity", (d) => (d.parent === root ? 1 : 0))
      .style("display", (d) => (d.parent === root ? "inline" : "none"))
      .each(function (d) {
        const t = d3.select(this);
        if (d.data.type === "genre") {
          t.append("tspan").attr("x", 0).text(GENRE_LABEL[d.data.name] || d.data.name);
          t.append("tspan").attr("x", 0).attr("dy", "1.15em")
            .style("font-family", "'IBM Plex Mono', monospace").style("font-size", "9px")
            .attr("fill", MUTED)
            .text((genreNum[d.data.name] || "") + " · " + (genreCounts[d.data.name] || 0) + " brani");
        } else if (d.data.type === "artist") {
          t.text(d.data.name.length > 22 ? d.data.name.slice(0, 21) + "…" : d.data.name);
        } else {
          t.text(d.data.name.length > 26 ? d.data.name.slice(0, 25) + "…" : d.data.name);
        }
      });

    // ---- strato RETE / PERCORSO (archi + marker + numeri), sopra i cerchi ----
    const gArc = svg.append("g").attr("fill", "none").style("pointer-events", "none");
    const gMark = svg.append("g");
    const gTag = svg.append("g").style("pointer-events", "none");

    node.transition().delay((d, i) => Math.min(600, i * 1.1)).duration(500).style("opacity", 1);

    let focus = root;
    let view;
    let mode = "tree";       // 'tree' | 'net' | 'route'
    let overlay = null;       // {kind:'net'|'route', ...}

    const P = (x, y, k) => [(x - view[0]) * k, (y - view[1]) * k];

    function drawOverlay() {
      if (!overlay) return;
      const k = DIA / view[2];
      if (overlay.kind === "net") {
        gArc.selectAll("path").attr("d", (a) => {
          const [x1, y1] = P(a.x1, a.y1, k);
          const [x2, y2] = P(a.x2, a.y2, k);
          const dx = x2 - x1, dy = y2 - y1, dist = Math.hypot(dx, dy) || 1;
          const off = Math.min(70, dist * 0.16);
          const cx = (x1 + x2) / 2 - (dy / dist) * off;
          const cy = (y1 + y2) / 2 + (dx / dist) * off;
          return "M" + x1 + "," + y1 + " Q" + cx + "," + cy + " " + x2 + "," + y2;
        });
      } else if (overlay.kind === "route") {
        const line = d3.line()
          .x((p) => P(p.x, p.y, k)[0]).y((p) => P(p.x, p.y, k)[1])
          .curve(d3.curveCatmullRom.alpha(0.5));
        gArc.selectAll("path").attr("d", (d) => line(d));
      }
      gMark.selectAll("circle")
        .attr("cx", (m) => P(m.leaf.x, m.leaf.y, k)[0])
        .attr("cy", (m) => P(m.leaf.x, m.leaf.y, k)[1]);
      gTag.selectAll("text").attr("transform", (m) => {
        const p = P(m.leaf.x, m.leaf.y, k);
        return "translate(" + p[0] + "," + (p[1] - (overlay.kind === "route" ? 9 : 12)) + ")";
      });
    }

    function applyView(v3) {
      const k = DIA / v3[2];
      view = v3;
      label.attr("transform", (d) => "translate(" + (d.x - v3[0]) * k + "," + (d.y - v3[1]) * k + ")");
      node.attr("transform", (d) => "translate(" + (d.x - v3[0]) * k + "," + (d.y - v3[1]) * k + ")");
      node.attr("r", (d) => d.r * k);
      drawOverlay();
    }

    function animateTo(v3) {
      svg.transition().duration(720).tween("zoom", () => {
        const i = d3.interpolateZoom(view, v3);
        return (tt) => applyView(i(tt));
      });
    }

    function fitTo(leaves) {
      const minX = Math.min(...leaves.map((l) => l.x - l.r));
      const maxX = Math.max(...leaves.map((l) => l.x + l.r));
      const minY = Math.min(...leaves.map((l) => l.y - l.r));
      const maxY = Math.max(...leaves.map((l) => l.y + l.r));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const size = Math.min(DIA, Math.max(maxX - minX, maxY - minY) * 1.2 + 60);
      animateTo([cx, cy, size]);
    }

    function setBreadcrumb(d) {
      setPath(d.ancestors().reverse().map((a) => ({ type: a.data.type, name: a.data.name, node: a })));
    }

    function clearOverlay() {
      gArc.selectAll("path").remove();
      gMark.selectAll("circle").remove();
      gTag.selectAll("text").remove();
      overlay = null;
    }

    function restyleTree() {
      node
        .attr("opacity", 1)
        .attr("fill", (d) =>
          d.data.type === "track" ? gcol(d.data.gname)
          : d.data.type === "artist" ? PAPER_DK
          : d3.color(gcol(d.data.gname)).copy({ opacity: 0.07 })
        )
        .attr("stroke", (d) =>
          d.data.type === "genre" ? gcol(d.data.gname)
          : d.data.type === "artist" ? "rgba(43,39,36,0.10)" : PAPER
        )
        .attr("stroke-width", (d) =>
          d.data.type === "genre" ? 1.1 : d.data.type === "artist" ? 0.8 : 0.6
        );
    }

    function dimBase() {
      node
        .attr("opacity", (d) => (d.data.type === "genre" ? 1 : d.data.type === "artist" ? 0.4 : 0.1))
        .attr("stroke-width", (d) => (d.data.type === "genre" ? 1.1 : d.data.type === "artist" ? 0.6 : 0.4));
    }

    function contextLabels() {
      label
        .style("display", (l) => (l.data.type === "genre" ? "inline" : "none"))
        .style("fill-opacity", (l) => (l.data.type === "genre" ? 0.55 : 0));
    }

    function focusLabels() {
      label
        .style("display", (l) => (l.parent === focus ? "inline" : "none"))
        .style("fill-opacity", (l) => (l.parent === focus ? 1 : 0));
    }

    // ---- CLASSIFICAZIONE: drill-down ----
    function zoomTo(d) {
      clearOverlay();
      restyleTree();
      mode = "tree";
      focus = d;
      const transition = svg.transition().duration(720).tween("zoom", () => {
        const i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2 + 8]);
        return (tt) => applyView(i(tt));
      });
      label
        .filter(function (l) { return l.parent === focus || this.style.display === "inline"; })
        .transition(transition)
        .style("fill-opacity", (l) => (l.parent === focus ? 1 : 0))
        .on("start", function (l) { if (l.parent === focus) this.style.display = "inline"; })
        .on("end", function (l) { if (l.parent !== focus) this.style.display = "none"; });
      setBreadcrumb(focus);
    }

    // ---- RETE: seleziona un brano, mostra i legami, inquadra il vicinato ----
    function selectTrack(track, dNode) {
      const selLeaf = dNode || leafById.get(track.id);
      if (!selLeaf) return;
      selIdRef.current = track.id;
      setSelected(track);
      setPlaylist(null);
      mode = "net";

      const nbrs = neighborMap.get(track.id) || [];
      const members = [{ id: track.id, leaf: selLeaf, kind: "sel", w: Infinity, g: track.genre }];
      const arcs = [];
      nbrs.forEach(({ id, w }) => {
        const lf = leafById.get(id);
        if (!lf) return;
        arcs.push({ x1: selLeaf.x, y1: selLeaf.y, x2: lf.x, y2: lf.y, w, gname: lf.data.gname });
        members.push({ id, leaf: lf, kind: "nbr", w, g: lf.data.gname });
      });
      overlay = { kind: "net", members };

      dimBase();

      gArc.selectAll("path").data(arcs).join("path")
        .attr("stroke", (a) => gcol(a.gname))
        .attr("stroke-width", (a) => 0.5 + Math.min(2.4, a.w * 0.18))
        .attr("stroke-opacity", (a) => 0.2 + Math.min(0.55, a.w * 0.06))
        .attr("stroke-linecap", "round");

      gMark.selectAll("circle").data(members, (m) => m.id).join("circle")
        .attr("r", (m) => (m.kind === "sel" ? 7 : 3.6 + Math.min(3.2, m.w * 0.22)))
        .attr("fill", (m) => gcol(m.g))
        .attr("stroke", (m) => (m.kind === "sel" ? INK : PAPER))
        .attr("stroke-width", (m) => (m.kind === "sel" ? 2 : 1))
        .style("cursor", "pointer")
        .on("click", (e, m) => {
          e.stopPropagation();
          if (m.kind === "nbr") { const nd = dataById.get(m.id); if (nd) selectTrack(nd, m.leaf); }
        })
        .each(function (m) {
          d3.select(this).selectAll("title").remove();
          const nd = dataById.get(m.id);
          d3.select(this).append("title").text(nd ? nd.title + " — " + nd.artist : "");
        });

      gTag.selectAll("text").data([members[0]], (m) => m.id).join("text")
        .attr("text-anchor", "middle").attr("fill", INK)
        .style("font-family", "'Spectral', Georgia, serif").style("font-size", "14px")
        .style("paint-order", "stroke").style("stroke", PAPER).style("stroke-width", "3px")
        .text(track.title.length > 30 ? track.title.slice(0, 29) + "…" : track.title);

      contextLabels();
      focus = selLeaf.parent;
      fitTo(members.map((m) => m.leaf));
      setBreadcrumb(selLeaf);
    }

    // ---- PERCORSO: playlist generata, disegnata in ordine d'ascolto ----
    function showRoute(ids) {
      const pts = ids.map((id) => leafById.get(id)).filter(Boolean);
      if (!pts.length) { exitOverlay(); return; }
      selIdRef.current = null;
      setSelected(null);
      mode = "route";
      const members = pts.map((lf, i) => ({
        id: lf.data.track.id, leaf: lf, kind: "route", idx: i + 1, g: lf.data.gname,
      }));
      overlay = { kind: "route", members };

      dimBase();

      gArc.selectAll("path").data([pts]).join("path")
        .attr("stroke", INK).attr("stroke-width", 1.6).attr("stroke-opacity", 0.5)
        .attr("stroke-linejoin", "round").attr("stroke-linecap", "round").attr("fill", "none");

      gMark.selectAll("circle").data(members, (m) => m.id).join("circle")
        .attr("r", 5).attr("fill", (m) => gcol(m.g)).attr("stroke", INK).attr("stroke-width", 1.2)
        .style("cursor", "pointer")
        .on("click", (e, m) => { e.stopPropagation(); const nd = dataById.get(m.id); if (nd) selectTrack(nd, m.leaf); })
        .each(function (m) {
          d3.select(this).selectAll("title").remove();
          const nd = dataById.get(m.id);
          d3.select(this).append("title").text(nd ? m.idx + ". " + nd.title + " — " + nd.artist : "");
        });

      gTag.selectAll("text").data(members, (m) => m.id).join("text")
        .attr("text-anchor", "middle").attr("fill", INK)
        .style("font-family", "'IBM Plex Mono', monospace").style("font-size", "9px")
        .style("paint-order", "stroke").style("stroke", PAPER).style("stroke-width", "2.5px")
        .text((m) => m.idx);

      contextLabels();
      fitTo(members.map((m) => m.leaf));
    }

    function exitOverlay() {
      selIdRef.current = null;
      setSelected(null);
      setPlaylist(null);
      clearOverlay();
      restyleTree();
      mode = "tree";
      focusLabels();
    }

    applyView([root.x, root.y, root.r * 2 + 8]);
    setBreadcrumb(root);

    svg.on("click", () => {
      const up = focus.parent || root;
      selIdRef.current = null;
      setSelected(null);
      setPlaylist(null);
      zoomTo(up);
    });

    vizRef.current = {
      root,
      zoomTo: (d) => { setSelected(null); setPlaylist(null); selIdRef.current = null; zoomTo(d); },
      jumpGenre: (g) => {
        const gn = root.children?.find((c) => c.data.name === g);
        if (gn) { setSelected(null); setPlaylist(null); selIdRef.current = null; zoomTo(gn); }
      },
      selectTrack: (id) => {
        const d = leafById.get(id), nd = dataById.get(id);
        if (d && nd) selectTrack(nd, d);
      },
      showRoute,
      clearOverlay: () => exitOverlay(),
      applySearch: (q) => {
        if (mode !== "tree") return;
        const has = q.trim().length > 0;
        const qq = norm(q);
        node.filter((d) => d.data.type === "track").attr("opacity", (d) =>
          !has || norm(d.data.track.title).includes(qq) || norm(d.data.track.artist).includes(qq) ? 1 : 0.1
        );
        node.filter((d) => d.data.type !== "track").attr("opacity", has ? 0.5 : 1);
      },
    };

    return () => { svg.on("click", null); vizRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hierarchy]);

  useEffect(() => { vizRef.current?.applySearch(query); }, [query]);

  // playlist -> percorso sulla mappa (al cambio)
  useEffect(() => {
    if (!vizRef.current) return;
    if (playlist && playlist.length) vizRef.current.showRoute(playlist);
  }, [playlist]);

  const jumpToGenre = useCallback((g) => { vizRef.current?.jumpGenre(g); setIndexOpen(false); }, []);
  const jumpToCrumb = useCallback((node) => { if (node) vizRef.current?.zoomTo(node); }, []);
  const pickTrackId = useCallback((id) => { vizRef.current?.selectTrack(id); }, []);

  // ---- chat: interpreta il messaggio e genera la playlist navigando il grafo ----
  const handleChat = useCallback((text) => {
    setChatInput("");
    const res = buildPlaylist(GRAPH, text);
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", res }]);
    setQuery("");
    setPlaylist(res.ok && res.ids.length ? res.ids : null);
  }, []);

  const generateFromNode = useCallback((node) => {
    if (!node) return;
    const res = buildFromSeed(GRAPH, node, 18);
    setMessages((m) => [
      ...m,
      { role: "user", text: `playlist from "${node.title}"` },
      { role: "assistant", res },
    ]);
    setChatOpen(true);
    setPlaylist(res.ok && res.ids.length ? res.ids : null);
  }, []);

  const clearPlaylist = useCallback(() => {
    setPlaylist(null);
    vizRef.current?.clearOverlay();
  }, []);

  // ---- export "senza setup": link Spotify esatti + CSV, poi Spotlistr/Spotify ----
  const sysMsg = useCallback((text, link, linkLabel) => {
    setMessages((m) => [...m, { role: "system", text, link, linkLabel }]);
    setChatOpen(true);
  }, []);

  const handleExport = useCallback(async (res) => {
    if (!res || !res.ok) return;
    window.open(SPOTLISTR_URL, "_blank", "noopener");
    const links = playlistLinks(res);
    downloadFile(exportFilename(res, "csv"), playlistCsv(res), "text/csv;charset=utf-8");
    const copied = await copyText(links);
    sysMsg(
      `${res.tracks.length} tracks exported — Spotify links ${copied ? "copied to clipboard" : "in the downloaded CSV"} and CSV saved. ` +
        `Paste them into Spotlistr (opened in a new tab) to create the playlist.`,
      SPOTLISTR_URL, "Open Spotlistr ↗"
    );
  }, [sysMsg]);

  // vicini del brano selezionato, per il pannello (navigazione testuale della rete)
  const neighborRows = useMemo(() => {
    if (!selected) return [];
    const arr = neighborMap.get(selected.id) || [];
    return arr.map(({ id, w }) => {
      const nd = dataById.get(id);
      return nd ? { ...nd, w, rel: relation(selected, nd) } : null;
    }).filter(Boolean);
  }, [selected, neighborMap, dataById]);
  const maxW = useMemo(() => neighborRows.reduce((m, r) => Math.max(m, r.w), 1), [neighborRows]);

  return (
    <div ref={wrapRef} style={{
      position: "relative", width: "100%", height: "100dvh", minHeight: "100vh",
      background: PAPER, color: INK, overflow: "hidden",
      fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        .atlas-search::placeholder { color: ${MUTED}; }
        .atlas-search:focus { outline: none; border-color: ${INK}; }
        .idx-row { transition: background .14s ease, padding-left .14s ease; }
        .idx-row:hover { background: rgba(43,39,36,0.05); padding-left: 14px !important; }
        .crumb:hover { color: ${INK} !important; text-decoration: underline; }
        .lnk:hover { opacity: .65; }
        .nbr-row:hover { background: rgba(43,39,36,0.05); }
        ::selection { background: ${INK}; color: ${PAPER}; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: rgba(43,39,36,0.18); border-radius: 4px; }
        @media (max-width: 720px) { .atlas-search, .mn-chat input { font-size: 16px !important; } }
      `}</style>

      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.05,
        backgroundImage: "radial-gradient(circle at 1px 1px, #000 1px, transparent 0)",
        backgroundSize: "22px 22px", zIndex: 1,
      }} />

      <svg ref={svgRef} width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", inset: 0, display: "block", zIndex: 2 }} />

      {/* TESTATA */}
      <header style={{
        position: "absolute", top: isMobile ? 14 : 26, left: isMobile ? 14 : 30,
        right: isMobile ? 14 : undefined, zIndex: 10, pointerEvents: "none",
      }}>
        <div style={{
          fontFamily: "'Spectral', Georgia, serif", fontWeight: 600,
          fontSize: isMobile ? 22 : 30, letterSpacing: "0.01em", lineHeight: 1.05,
        }}>New&nbsp;Release&nbsp;Atlas</div>
        <div style={{
          fontSize: 10.5, letterSpacing: "0.06em", color: MUTED, marginTop: 5, textTransform: "uppercase",
        }}>
          Classificazione &amp; rete · {GRAPH.nodes.length} brani · {totalArtists} artisti · {orderedGenres.length} generi
        </div>
        <nav style={{
          marginTop: 12, fontSize: 11, color: MUTED, pointerEvents: "auto",
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4,
          maxWidth: isMobile ? "100%" : 340,
        }}>
          {path.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ opacity: 0.5 }}>›</span>}
              <span className="crumb" onClick={() => jumpToCrumb(c.node)} style={{
                cursor: "pointer", color: i === path.length - 1 ? INK : MUTED,
                fontWeight: i === path.length - 1 ? 500 : 400,
              }}>
                {c.type === "genre" ? GENRE_LABEL[c.name] || c.name
                  : c.type === "root" ? "Archivio"
                  : c.type === "track" ? (c.name.length > 18 ? c.name.slice(0, 17) + "…" : c.name)
                  : c.name}
              </span>
            </React.Fragment>
          ))}
        </nav>
      </header>

      {/* RICERCA */}
      {!isMobile && (
        <div style={{ position: "absolute", top: 26, right: 30, zIndex: 10 }}>
          <input className="atlas-search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="cerca brano o artista" style={{
              width: 220, padding: "9px 12px", background: "rgba(255,255,255,0.5)",
              border: "1px solid rgba(43,39,36,0.2)", borderRadius: 2,
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: INK,
            }} />
        </div>
      )}

      {/* INDICE GENERI */}
      {!isMobile && (
        <aside style={{
          position: "absolute", left: 30, bottom: 26, zIndex: 10, width: 250,
          background: "rgba(244,241,234,0.82)", backdropFilter: "blur(3px)",
          border: "1px solid rgba(43,39,36,0.12)", borderRadius: 3,
          padding: "12px 0 8px", maxHeight: "50vh", overflowY: "auto",
        }}>
          <div style={{
            fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED,
            padding: "0 14px 8px", borderBottom: "1px solid rgba(43,39,36,0.10)",
          }}>Indice dei generi</div>
          {orderedGenres.map((g) => (
            <div key={g} className="idx-row" onClick={() => jumpToGenre(g)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "7px 14px", cursor: "pointer",
            }}>
              <span style={{ fontSize: 10, color: MUTED, width: 18 }}>{genreNum[g]}</span>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: gcol(g), flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: "'Spectral', Georgia, serif", fontSize: 14 }}>{GENRE_LABEL[g] || g}</span>
              <span style={{ fontSize: 10, color: MUTED }}>{genreCounts[g]}</span>
            </div>
          ))}
        </aside>
      )}

      {/* INDICE mobile */}
      {isMobile && (
        <>
          <button onClick={() => setIndexOpen((v) => !v)} style={{
            position: "absolute", bottom: 70, left: 14, zIndex: 12, padding: "10px 14px",
            background: INK, color: PAPER, border: "none", borderRadius: 2,
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, letterSpacing: "0.05em",
          }}>{indexOpen ? "chiudi" : "indice generi"}</button>
          {indexOpen && (
            <div style={{
              position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 11, background: PAPER,
              borderTop: "1px solid rgba(43,39,36,0.15)", padding: "16px 14px 70px",
              maxHeight: "70vh", overflowY: "auto",
            }}>
              <div style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED, marginBottom: 10 }}>
                Indice dei generi
              </div>
              {orderedGenres.map((g) => (
                <div key={g} onClick={() => jumpToGenre(g)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 4px",
                  borderBottom: "1px solid rgba(43,39,36,0.07)",
                }}>
                  <span style={{ fontSize: 10, color: MUTED, width: 18 }}>{genreNum[g]}</span>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: gcol(g) }} />
                  <span style={{ flex: 1, fontFamily: "'Spectral', Georgia, serif", fontSize: 15 }}>{GENRE_LABEL[g] || g}</span>
                  <span style={{ fontSize: 11, color: MUTED }}>{genreCounts[g]}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* PANNELLO DETTAGLIO + RETE */}
      {selected && (
        <aside onClick={(e) => e.stopPropagation()} style={{
          position: "absolute", zIndex: 13,
          ...(isMobile
            ? { left: 0, right: 0, bottom: 0, borderTop: "1px solid rgba(43,39,36,0.15)", maxHeight: "60vh" }
            : { right: 30, top: 96, width: 312, borderRadius: 3, border: "1px solid rgba(43,39,36,0.14)", maxHeight: "calc(100dvh - 130px)" }),
          background: PAPER, padding: isMobile ? "16px 16px 22px" : "18px 18px 16px",
          boxShadow: "0 8px 30px rgba(43,39,36,0.12)", display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: gcol(selected.genre) }} />
            <span style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>
              {genreNum[selected.genre]} · {GENRE_LABEL[selected.genre] || selected.genre}
            </span>
            <span onClick={() => vizRef.current?.zoomTo(vizRef.current.root)}
              style={{ marginLeft: "auto", cursor: "pointer", color: MUTED, fontSize: 16 }}>×</span>
          </div>

          <div style={{ fontFamily: "'Spectral', Georgia, serif", fontSize: 21, fontWeight: 500, lineHeight: 1.18 }}>
            {selected.title}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{selected.artist}</div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>
            {selected.duration && <>durata {selected.duration} · </>}{(selected.genres || []).join(" · ")}
          </div>

          <div style={{ display: "flex", gap: 14, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
            {selected.url && (
              <a className="lnk" href={selected.url} target="_blank" rel="noopener noreferrer" style={{
                fontSize: 12, color: INK, borderBottom: "1px solid " + INK, textDecoration: "none", paddingBottom: 1,
              }}>Apri su Spotify ↗</a>
            )}
            <button onClick={() => generateFromNode(selected)} style={{
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: PAPER, background: INK,
              border: "none", borderRadius: 14, padding: "5px 12px", cursor: "pointer",
            }}>♫ playlist da qui</button>
          </div>

          {/* RETE: brani connessi, navigabili */}
          {neighborRows.length > 0 && (
            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div style={{
                fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, marginBottom: 8,
                display: "flex", justifyContent: "space-between",
              }}>
                <span>Rete · brani connessi</span><span>{neighborRows.length}</span>
              </div>
              <div style={{ overflowY: "auto", margin: "0 -6px", paddingRight: 2 }}>
                {neighborRows.map((r) => (
                  <div key={r.id} className="nbr-row" onClick={() => pickTrackId(r.id)} style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "7px 6px", cursor: "pointer", borderRadius: 2,
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: gcol(r.genre), flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12.5, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.title}
                      </span>
                      <span style={{ fontSize: 10, color: MUTED }}>{r.artist} · {r.rel.label}</span>
                    </span>
                    <span title={"forza legame " + r.w} style={{
                      width: 34, height: 3, background: "rgba(43,39,36,0.12)", borderRadius: 2, flexShrink: 0, position: "relative",
                    }}>
                      <span style={{
                        position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 2,
                        width: Math.max(8, (r.w / maxW) * 100) + "%", background: gcol(r.genre),
                      }} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {!isMobile && !selected && !playlist && (
        <div style={{
          position: "absolute", right: 30, bottom: 26, zIndex: 9, fontSize: 10, color: MUTED,
          textAlign: "right", lineHeight: 1.6, maxWidth: 210, pointerEvents: "none",
        }}>
          Clic su un genere per entrare nel territorio · clic su un brano per vederne la rete · clic su un connesso per navigare
        </div>
      )}

      {/* CHAT -> playlist generata dal grafo */}
      <Chat
        open={chatOpen}
        setOpen={setChatOpen}
        messages={messages}
        value={chatInput}
        onChange={setChatInput}
        onSubmit={handleChat}
        onClear={clearPlaylist}
        onPick={pickTrackId}
        onExport={handleExport}
        genreColor={gcol}
        hasPlaylist={!!playlist}
      />
    </div>
  );
}

export default function MusicNetwork() {
  const [ready, setReady] = useState(GRAPH !== null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (GRAPH !== null) return;
    fetch(import.meta.env.BASE_URL + "graph.json")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((data) => { GRAPH = data; setReady(true); })
      .catch((e) => setError(e.message));
  }, []);

  if (error)
    return (
      <div style={{ padding: 40, fontFamily: "'IBM Plex Mono', monospace", color: "#c75b4a" }}>
        Errore nel caricamento di graph.json: {error}
      </div>
    );
  if (!ready)
    return (
      <div style={{ padding: 40, fontFamily: "'IBM Plex Mono', monospace", color: "#9a938a" }}>
        Caricamento dell'atlante…
      </div>
    );
  return <MusicNetworkInner />;
}
