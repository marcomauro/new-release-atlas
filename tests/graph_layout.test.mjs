// Unit tests for the map's pure layout helpers (src/graph/layout.js):
// the whole-map fit and the thinning of prolific artists' cliques, which
// must change only what is DRAWN — never the graph the playlists walk.
//
// Run:  npm test   (node --test, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fitTransform, sparseArtistDrops } from "../src/graph/layout.js";
import { hydrateGraph } from "../src/graph/hydrate.js";
import { buildFromSeed, buildPlaylist } from "../src/playlist.js";

const node = (id, artist, playlist = 1) => ({ id, artist, artists: [artist], playlists: [playlist] });
const artistLink = (s, t) => ({ source: s, target: t, c: [1, 0, 0, 0] });
const clique = (ids) => ids.flatMap((a, i) => ids.slice(i + 1).map((b) => artistLink(a, b)));

test("fitTransform frames the points inside the free area", () => {
  const pts = [{ x: 0, y: 0 }, { x: 1000, y: 500 }];
  const t = fitTransform(pts, { w: 800, h: 600 }, { l: 100, r: 100, t: 50, b: 50 });
  assert.equal(t.k, 0.6); // 600 free px / 1000 graph units
  assert.equal(t.x + 0 * t.k, 100); // left edge lands on the left margin
  assert.equal(t.y + 250 * t.k, 300); // vertical centre in the free area
});

test("fitTransform clamps the zoom factor", () => {
  const dot = [{ x: 5, y: 5 }];
  assert.equal(fitTransform(dot, { w: 800, h: 600 }, { l: 0, r: 0, t: 0, b: 0 }).k, 1);
  assert.equal(fitTransform(dot, { w: 800, h: 600 }, { l: 0, r: 0, t: 0, b: 0 }, { maxK: 2 }).k, 2);
  const huge = [{ x: 0, y: 0 }, { x: 1e6, y: 0 }];
  assert.equal(fitTransform(huge, { w: 800, h: 600 }, { l: 0, r: 0, t: 0, b: 0 }).k, 0.12);
});

test("small artist cliques stay whole", () => {
  const nodes = ["a", "b", "c", "d", "e"].map((id) => node(id, "Duo"));
  assert.equal(sparseArtistDrops(nodes, clique(nodes.map((n) => n.id))).size, 0);
});

test("a prolific artist keeps a connected ring with chords", () => {
  const ids = Array.from({ length: 12 }, (_, i) => "t" + String(i).padStart(2, "0"));
  const nodes = ids.map((id, i) => node(id, "Big", i + 1));
  const links = clique(ids); // 66 edges
  const drops = sparseArtistDrops(nodes, links);
  const kept = links.filter((_, i) => !drops.has(i));
  assert.equal(kept.length, 24); // 12 tracks × 2 chords
  // every track keeps 4 neighbours and the group stays connected
  const adj = new Map(ids.map((id) => [id, new Set()]));
  for (const l of kept) { adj.get(l.source).add(l.target); adj.get(l.target).add(l.source); }
  for (const s of adj.values()) assert.equal(s.size, 4);
  const seen = new Set(["t00"]);
  const stack = ["t00"];
  while (stack.length) for (const n of adj.get(stack.pop())) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  assert.equal(seen.size, ids.length);
});

test("edges that also share a genre or a playlist are never dropped", () => {
  const ids = Array.from({ length: 8 }, (_, i) => "m" + i);
  const nodes = ids.map((id) => node(id, "Big"));
  const links = clique(ids).map((l) => ({ ...l, c: [1, 1, 0, 0] }));
  assert.equal(sparseArtistDrops(nodes, links).size, 0);
});

// The real archive: the thinning is a drawing decision. The playlist walk
// reads the full GRAPH, so the same seed must give the same route.
const GRAPH = hydrateGraph(JSON.parse(readFileSync(new URL("../public/graph.json", import.meta.url))));

const seeded = (fn) => {
  const rnd = Math.random;
  let s = 42;
  Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  try { return fn(); } finally { Math.random = rnd; }
};

test("thinning the real graph leaves the data and the playlists untouched", () => {
  const before = JSON.stringify(GRAPH.links);
  const seed = GRAPH.nodes.find((n) => n.artists.includes("Louie Vega"));
  const fromSeed = () => seeded(() => buildFromSeed(GRAPH, seed, 18).ids);
  const fromText = () => seeded(() => buildPlaylist(GRAPH, "late night jazz").ids);
  const routes = [fromSeed(), fromText()];

  const drops = sparseArtistDrops(GRAPH.nodes, GRAPH.links);
  assert.ok(drops.size > 0);
  for (const i of drops) {
    const c = GRAPH.links[i].c;
    assert.ok(c[0] > 0 && c[1] + c[2] + c[3] === 0, "only pure artist edges are thinned");
  }
  assert.equal(JSON.stringify(GRAPH.links), before);
  assert.deepEqual([fromSeed(), fromText()], routes);
});
