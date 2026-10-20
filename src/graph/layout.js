// Force-layout helpers for the genre map. Pure functions of their inputs —
// no React, no component state.

import * as d3 from "d3";

// "Cluster" cohesion force: every tick pushes the nodes sharing the same key
// (e.g. genre, or genre+artist) toward their centroid. Used to compact the
// genre clusters and to keep same-artist tracks close within a cluster.
// Optional groupScale(size) rescales the pull per group: prolific artists
// (10-20 tracks) would otherwise collapse into packed blobs, since their
// total centroid pull grows with the group while collision only resists
// linearly. E.g. (n) => 1/Math.sqrt(n/2) keeps duos at full strength and
// tames the big groups.
export function clusterForce(keyFn, strength, groupScale) {
  let groups = [];
  function force(alpha) {
    for (const arr of groups) {
      if (arr.length < 2) continue;
      const k = strength * (groupScale ? groupScale(arr.length) : 1) * alpha;
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

// Deterministic 0..1 jitter from an id (stable hash). Used to slightly vary
// the collision radius: discs that are NOT all equal -> no hexagonal packing
// (which requires equal circles), a more organic arrangement.
export function hashJitter(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

// Zoom transform {x, y, k} that fits the points' bounding box (expanded by
// pad, graph units) inside the viewport minus the UI margins {l, r, t, b}
// (screen px). k is clamped to [minK, maxK]. Shared by the initial/reset
// fit of the whole map and by the route fit.
export function fitTransform(pts, dims, m, { pad = 0, minK = 0.12, maxK = 1 } = {}) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const uw = Math.max(120, dims.w - m.l - m.r);
  const uh = Math.max(120, dims.h - m.t - m.b);
  const bw = Math.max(60, maxX - minX) + 2 * pad;
  const bh = Math.max(60, maxY - minY) + 2 * pad;
  const k = Math.max(minK, Math.min(maxK, uw / bw, uh / bh));
  return {
    x: m.l + uw / 2 - k * ((minX + maxX) / 2),
    y: m.t + uh / 2 - k * ((minY + maxY) / 2),
    k,
  };
}

// Same-artist links kept for DRAWING and for the LINK FORCE. Artist edges
// are a complete clique per artist (n tracks -> n(n-1)/2 edges): Louie Vega
// alone has 231. Up to maxClique tracks the clique stays whole; above it the
// group keeps a ring with chords — each track linked to the next `k` in
// release order (first playlist, then id) — which stays connected and
// cohesive with ~k·n edges. Only edges that are PURELY artist (no shared
// genre or playlist component) can be dropped. Returns the Set of the
// link indices to drop; the data (and so the playlist walk, which reads
// GRAPH.links) is untouched.
export function sparseArtistDrops(nodes, links, { maxClique = 5, k = 2 } = {}) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const groups = new Map();
  nodes.forEach((n, i) => {
    for (const a of new Set(n.artists || [n.artist])) {
      if (!groups.has(a)) groups.set(a, []);
      groups.get(a).push(i);
    }
  });
  const key = (a, b) => (a < b ? a * 1e6 + b : b * 1e6 + a);
  const keep = new Set();
  let big = false;
  for (const ids of groups.values()) {
    if (ids.length <= maxClique) {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) keep.add(key(ids[i], ids[j]));
      continue;
    }
    big = true;
    const first = (i) => Math.min(...(nodes[i].playlists || [0]));
    const ord = [...ids].sort((a, b) => first(a) - first(b) || (nodes[a].id < nodes[b].id ? -1 : 1));
    for (let i = 0; i < ord.length; i++)
      for (let s = 1; s <= k; s++) keep.add(key(ord[i], ord[(i + s) % ord.length]));
  }
  const drops = new Set();
  if (!big) return drops;
  links.forEach((l, li) => {
    const c = l.c || [0, 0, 0, 0];
    if (!(c[0] > 0) || c[1] + c[2] + c[3] > 0) return;
    const s = idx.get(l.source.id ?? l.source);
    const t = idx.get(l.target.id ?? l.target);
    if (!keep.has(key(s, t))) drops.add(li);
  });
  return drops;
}

// Genre anchors "packed" PROPORTIONALLY to cluster size. Each genre gets a
// territory radius ∝ √(track count) → area ∝ count → ~uniform density across
// the canvas. A DETERMINISTIC mini-simulation (golden-spiral init, no random)
// lays the territories out around the centre without overlaps; the result is
// then scaled to fill the viewport (with margins, adapting to the aspect
// ratio). Replaces the fixed-step ring, which squeezed the large clusters,
// scattered the small ones and left the centre empty.
export function packGenreAnchors(genres, counts, dims) {
  const cx = dims.w / 2, cy = dims.h / 2;
  const GOLD = Math.PI * (3 - Math.sqrt(5)); // golden angle (reproducible init)
  const terr = (g) => Math.sqrt(Math.max(1, counts[g] || 1));
  const a = genres.map((g, i) => ({
    genre: g, r: terr(g),
    x: cx + 14 * Math.sqrt(i + 0.5) * Math.cos(i * GOLD),
    y: cy + 14 * Math.sqrt(i + 0.5) * Math.sin(i * GOLD),
  }));
  const sim = d3
    .forceSimulation(a)
    // Wide padding between territories (+6): reserves empty space around each
    // cluster so no outlines touch. Coverage becomes less homogeneous (islands
    // with gaps between them) — a deliberate trade-off.
    .force("collide", d3.forceCollide((d) => d.r + 6).iterations(6))
    .force("x", d3.forceX(cx).strength(0.045))
    .force("y", d3.forceY(cy).strength(0.045))
    .stop();
  for (let i = 0; i < 320; i++) sim.tick();
  // bounding box of the territories → fit into the canvas with margins
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const d of a) {
    minX = Math.min(minX, d.x - d.r); maxX = Math.max(maxX, d.x + d.r);
    minY = Math.min(minY, d.y - d.r); maxY = Math.max(maxY, d.y + d.r);
  }
  const margin = Math.min(dims.w, dims.h) * 0.10;
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  let sx = (dims.w - 2 * margin) / bw, sy = (dims.h - 2 * margin) / bh;
  // cap the distortion between axes (fills widescreen without over-stretching)
  const RATIO = 1.7;
  if (sx > sy * RATIO) sx = sy * RATIO;
  if (sy > sx * RATIO) sy = sx * RATIO;
  const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
  const m = new Map();
  for (const d of a) m.set(d.genre, { x: cx + (d.x - bcx) * sx, y: cy + (d.y - bcy) * sy });
  return m;
}
