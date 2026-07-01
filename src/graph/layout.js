// Force-layout helpers for the genre map. Pure functions of their inputs —
// no React, no component state.

import * as d3 from "d3";

// "Cluster" cohesion force: every tick pushes the nodes sharing the same key
// (e.g. genre, or genre+artist) toward their centroid. Used to compact the
// genre clusters and to keep same-artist tracks close within a cluster.
export function clusterForce(keyFn, strength) {
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

// Deterministic 0..1 jitter from an id (stable hash). Used to slightly vary
// the collision radius: discs that are NOT all equal -> no hexagonal packing
// (which requires equal circles), a more organic arrangement.
export function hashJitter(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
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
