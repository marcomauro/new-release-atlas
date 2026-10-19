// Unit tests for the one-track-at-a-time route navigation
// (src/playbackRoute.js): skip unplayable tracks, repeat, shuffle.
//
// Run:  npm test   (node --test, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";
import { step, firstPlayable, afterEnd, shuffledOrder } from "../src/playbackRoute.js";

const only = (...ok) => (i) => ok.includes(i);

test("step moves forward and backward in route order", () => {
  assert.equal(step({ index: 0, count: 4 }), 1);
  assert.equal(step({ index: 2, count: 4, dir: -1 }), 1);
});

test("step skips tracks the source cannot play", () => {
  assert.equal(step({ index: 0, count: 5, playable: only(0, 3) }), 3);
  assert.equal(step({ index: 3, count: 5, dir: -1, playable: only(0, 3) }), 0);
});

test("step stops at the ends unless repeat is all", () => {
  assert.equal(step({ index: 3, count: 4 }), -1);
  assert.equal(step({ index: 0, count: 4, dir: -1 }), -1);
  assert.equal(step({ index: 3, count: 4, repeat: "all" }), 0);
  assert.equal(step({ index: 0, count: 4, dir: -1, repeat: "all" }), 3);
});

test("step returns -1 when nothing is playable", () => {
  assert.equal(step({ index: 0, count: 3, repeat: "all", playable: () => false }), -1);
  assert.equal(step({ index: 0, count: 0 }), -1);
});

test("a single playable track repeats with repeat all", () => {
  assert.equal(step({ index: 2, count: 4, repeat: "all", playable: only(2) }), 2);
});

test("step follows the shuffle order", () => {
  const order = [2, 0, 3, 1];
  assert.equal(step({ index: 2, count: 4, order }), 0);
  assert.equal(step({ index: 0, count: 4, order }), 3);
  assert.equal(step({ index: 1, count: 4, order }), -1);
  assert.equal(step({ index: 1, count: 4, order, repeat: "all" }), 2);
});

test("firstPlayable keeps a playable index, else moves forward", () => {
  assert.equal(firstPlayable({ index: 1, count: 4 }), 1);
  assert.equal(firstPlayable({ index: 1, count: 4, playable: only(3) }), 3);
  assert.equal(firstPlayable({ index: 3, count: 4, playable: only(0) }), -1);
});

test("afterEnd: repeat one replays, otherwise advances", () => {
  assert.equal(afterEnd({ index: 1, count: 3, repeat: "one" }), 1);
  assert.equal(afterEnd({ index: 1, count: 3 }), 2);
  assert.equal(afterEnd({ index: 2, count: 3 }), -1);
  assert.equal(afterEnd({ index: 2, count: 3, repeat: "all" }), 0);
});

test("shuffledOrder is a permutation that starts from the current track", () => {
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const o = shuffledOrder(10, 4, rnd);
  assert.equal(o[0], 4);
  assert.deepEqual([...o].sort((a, b) => a - b), [...Array(10).keys()]);
});
