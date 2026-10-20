// Canvas renderer for the genre map: one <canvas>, painted at most once per
// animation frame (simulation ticks, zoom, hover and state changes only mark
// it dirty). It holds no logic about WHAT is highlighted — MusicNetwork
// computes the view (per-node opacity/stroke, per-link opacity, labels, the
// route) and hands it over; this module paints it and answers "which node
// is under the pointer?".
//
// Replaces ~10k SVG elements whose attributes were rewritten on every tick:
// the per-frame main-thread work drops from ~23 ms to ~1 ms, and the
// rasterization goes to the GPU.

import { INK, PAPER, MUTED, ACCENT, gColor } from "../theme.js";

const GLOW = "rgba(31,182,232,0.95)";       // selected / playing node halo
const ROUTE_GLOW = "rgba(31,182,232,0.7)";  // playlist route halo
const FONT = "'Spectral', Georgia, serif";
const linkWidth = (w) => Math.min(2, 0.3 + w * 0.1);

export function createCanvasMap(canvas, { nodes, links, radius }) {
  const ctx = canvas.getContext("2d");
  const N = nodes.length;
  const lw = links.map((l) => linkWidth(l.weight));
  // links incident to each node index (hover highlight)
  const incident = Array.from({ length: N }, () => []);
  let incidentReady = false;

  let dims = { w: 0, h: 0 }, dpr = 1;
  let t = { x: 0, y: 0, k: 1 };
  let view = null;          // structural state, see setView()
  let hover = null;         // { index, nbr: Set<index> } — overrides the view
  let focusLinks = [];      // thinned-out artist edges of the focused node
  let route = [];           // node datums in listening order
  let showRoute = false;
  let labelPx = 10;
  let labelOffsets = new Map(); // id -> { dx, dy, anchor } in graph units
  let linkBuckets = null, nodeGroups = null; // rebuilt when the view changes
  let queued = false;

  // needs the link force to have resolved source/target ids into nodes
  const resolveIncident = () => {
    if (incidentReady) return;
    links.forEach((l, i) => {
      incident[l.source.index].push(i);
      incident[l.target.index].push(i);
    });
    incidentReady = true;
  };

  // ---- effective state (view + hover) ------------------------------------
  const nodeAlpha = (i) => {
    if (hover) return i === hover.index ? 1 : hover.nbr.has(i) ? 0.96 : 0.08;
    return view ? view.nodeAlpha[i] : 0.96;
  };
  const interactive = (i) => {
    if (hover) return i === hover.index || hover.nbr.has(i);
    return view ? view.interactive[i] === 1 : true;
  };
  const labelAlpha = (i) => {
    if (hover) return i === hover.index ? 1 : hover.nbr.has(i) ? 0.8 : 0;
    return view ? view.labelAlpha[i] : 0;
  };

  function rebuild() {
    resolveIncident();
    // links grouped by (opacity, width): one state change per group
    const hl = hover ? new Set(incident[hover.index]) : null;
    const b = new Map();
    links.forEach((l, i) => {
      const a = hl ? (hl.has(i) ? 0.5 : 0.02) : view ? view.linkAlpha[i] : 0.1;
      const key = a + "|" + lw[i];
      let g = b.get(key);
      if (!g) b.set(key, (g = { a, w: lw[i], ls: [] }));
      g.ls.push(l);
    });
    linkBuckets = [...b.values()];
    // nodes with the default ring are batched by (colour, opacity); the few
    // with a special ring or a halo are painted one by one, on top
    const g = new Map();
    const special = [];
    for (let i = 0; i < N; i++) {
      const d = nodes[i];
      const a = nodeAlpha(i);
      const sw = hover && i === hover.index ? 2.4 : view ? view.strokeW[i] : 1.2;
      const sc = hover && i === hover.index ? INK : view ? view.strokeC[i] : PAPER;
      const glow = view ? view.glow[i] === 1 : false;
      if (sw !== 1.2 || sc !== PAPER || glow) { special.push({ d, a, sw: glow ? 3.5 : sw, sc, glow }); continue; }
      const key = d.genre + "|" + a;
      let gr = g.get(key);
      if (!gr) g.set(key, (gr = { a, color: gColor(d.genre), ns: [] }));
      gr.ns.push(d);
    }
    nodeGroups = { batches: [...g.values()].sort((p, q) => p.a - q.a), special };
  }

  // ---- painting ------------------------------------------------------------
  function draw() {
    if (!linkBuckets) rebuild();
    const { k } = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * t.x, dpr * t.y);
    ctx.lineCap = "butt";

    // links: one stroke per line, like SVG, so overlapping lines add up
    // (that is what shows the dense bundles between clusters)
    ctx.strokeStyle = INK;
    for (const g of linkBuckets) {
      ctx.globalAlpha = g.a;
      ctx.lineWidth = g.w;
      for (const l of g.ls) {
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
        ctx.stroke();
      }
    }
    if (focusLinks.length) {
      ctx.globalAlpha = 0.5;
      for (const l of focusLinks) {
        ctx.lineWidth = linkWidth(l.weight);
        ctx.beginPath();
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
        ctx.stroke();
      }
    }

    // playlist route: thick and bright at the first track, thin and faded
    // at the last, so its direction reads at a glance
    if (showRoute && !hover && route.length > 1) {
      const denom = Math.max(1, route.length - 2);
      ctx.save();
      ctx.strokeStyle = ACCENT;
      ctx.lineCap = "round";
      ctx.shadowColor = ROUTE_GLOW;
      ctx.shadowBlur = 4 * dpr;
      for (let i = 0; i < route.length - 1; i++) {
        ctx.globalAlpha = 0.95 - 0.62 * (i / denom);
        ctx.lineWidth = 3.6 - 2.6 * (i / denom);
        ctx.beginPath();
        ctx.moveTo(route[i].x, route[i].y);
        ctx.lineTo(route[i + 1].x, route[i + 1].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // nodes
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.2;
    for (const gr of nodeGroups.batches) {
      ctx.globalAlpha = gr.a;
      ctx.fillStyle = gr.color;
      ctx.beginPath();
      for (const d of gr.ns) {
        const r = radius(d);
        ctx.moveTo(d.x + r, d.y);
        ctx.arc(d.x, d.y, r, 0, 2 * Math.PI);
      }
      ctx.fill();
      ctx.stroke();
    }
    for (const s of nodeGroups.special) {
      ctx.save();
      ctx.globalAlpha = s.a;
      if (s.glow) { ctx.shadowColor = GLOW; ctx.shadowBlur = 9 * dpr; }
      ctx.beginPath();
      ctx.arc(s.d.x, s.d.y, radius(s.d), 0, 2 * Math.PI);
      ctx.fillStyle = gColor(s.d.genre);
      ctx.fill();
      ctx.lineWidth = s.sw;
      ctx.strokeStyle = s.sc;
      ctx.stroke();
      ctx.restore();
    }

    // labels, in screen space at a controlled size: title in ink, then the
    // artist in a muted tone, over a paper-coloured halo
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${labelPx}px ${FONT}`;
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1.2, Math.min(4, 2.6 * k));
    ctx.strokeStyle = PAPER;
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < N; i++) {
      const a = labelAlpha(i);
      if (!a) continue;
      const d = nodes[i];
      const off = labelOffsets.get(d.id);
      const r = radius(d);
      const dx = off ? off.dx : r + 3;
      const dy = off ? off.dy : 3;
      const title = d.title;
      const artist = " — " + d.artist;
      const tw = ctx.measureText(title).width;
      const aw = ctx.measureText(artist).width;
      let x = d.x * k + t.x + dx * k;
      const y = d.y * k + t.y + dy * k;
      if (off && off.anchor === "end") x -= tw + aw;
      ctx.globalAlpha = a;
      ctx.strokeText(title, x, y);
      ctx.strokeText(artist, x + tw, y);
      ctx.fillStyle = INK;
      ctx.fillText(title, x, y);
      ctx.fillStyle = MUTED;
      ctx.fillText(artist, x + tw, y);
    }
    ctx.globalAlpha = 1;
  }

  const api = {
    requestDraw() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; draw(); });
    },
    resize(w, h) {
      dims = { w, h };
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      api.requestDraw();
    },
    setTransform(tr) { t = { x: tr.x, y: tr.y, k: tr.k }; api.requestDraw(); },
    // view: { nodeAlpha, interactive, strokeW, strokeC, glow, labelAlpha } per
    // node index, { linkAlpha } per link index, plus showRoute
    setView(v) { view = v; showRoute = v.showRoute; linkBuckets = null; api.requestDraw(); },
    setHover(h) { hover = h; linkBuckets = null; api.requestDraw(); },
    setFocusLinks(ls) { focusLinks = ls || []; api.requestDraw(); },
    setRoute(pts) { route = pts || []; api.requestDraw(); },
    setLabelPx(px) { labelPx = px; api.requestDraw(); },
    setLabelOffsets(m) { labelOffsets = m; api.requestDraw(); },
    // on-screen width of a node's full label ("title — artist") at the current size
    measureLabel(d) {
      ctx.font = `${labelPx}px ${FONT}`;
      return ctx.measureText(d.title + " — " + d.artist).width;
    },
    // the interactive node under a screen point (nearest one if several)
    nodeAt(px, py) {
      const x = (px - t.x) / t.k, y = (py - t.y) / t.k;
      let best = null, bestD = Infinity;
      for (let i = 0; i < N; i++) {
        const d = nodes[i];
        const dist = Math.hypot(d.x - x, d.y - y);
        if (dist <= radius(d) + 0.6 && dist < bestD && interactive(i)) { best = d; bestD = dist; }
      }
      return best;
    },
    get dims() { return dims; },
  };
  // Spectral arrives after the first paint: repaint the labels with it
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => api.requestDraw());
  return api;
}
