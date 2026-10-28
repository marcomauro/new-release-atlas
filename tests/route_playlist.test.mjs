import test from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE_PLAYLIST_NAME, ROUTE_PLAYLIST_SCOPE, hasScope, chunk, findRoutePlaylist,
} from "../src/routePlaylist.js";

test("hasScope matches whole scope names only", () => {
  const granted = "user-read-playback-state playlist-modify-private user-modify-playback-state";
  assert.equal(hasScope(granted, ROUTE_PLAYLIST_SCOPE), true);
  assert.equal(hasScope("playlist-modify-public user-read-playback-state", ROUTE_PLAYLIST_SCOPE), false);
  assert.equal(hasScope("", ROUTE_PLAYLIST_SCOPE), false);
  assert.equal(hasScope(undefined, ROUTE_PLAYLIST_SCOPE), false);
});

test("chunk splits writes at the 100-URI limit", () => {
  const uris = Array.from({ length: 205 }, (_, i) => `spotify:track:${i}`);
  const parts = chunk(uris);
  assert.deepEqual(parts.map((p) => p.length), [100, 100, 5]);
  assert.deepEqual(parts.flat(), uris);
  assert.deepEqual(chunk([]), []);
});

test("findRoutePlaylist picks the one owned by the user", () => {
  const items = [
    { id: "a", name: "Groove", owner: { id: "me" } },
    { id: "b", name: ROUTE_PLAYLIST_NAME, owner: { id: "someone-else" } },
    null,
    { id: "c", name: ROUTE_PLAYLIST_NAME, owner: { id: "me" } },
  ];
  assert.equal(findRoutePlaylist(items, "me").id, "c");
  assert.equal(findRoutePlaylist(items, "nobody"), null);
  assert.equal(findRoutePlaylist(undefined, "me"), null);
});
