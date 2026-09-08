// Unit tests for the Spotify Connect transport layer (src/connectTransport.js):
// request deadline, retry policy, serial command queue, wait-until poller.
//
// Run:  npm test   (node --test, no dependencies)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchWithTimeout, isTransient, withRetry, createQueue, waitFor, sleep,
} from "../src/connectTransport.js";

// A fetch that never answers but honours the abort signal, like the real one.
const hungFetch = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener("abort", () => reject(new Error("aborted")));
});

test("fetchWithTimeout: a request that never answers is aborted as TIMEOUT", async () => {
  await assert.rejects(
    fetchWithTimeout(hungFetch, "https://x/y", {}, 30),
    (e) => e.status === 0 && e.reason === "TIMEOUT",
  );
});

test("fetchWithTimeout: a normal response passes through untouched", async () => {
  const r = await fetchWithTimeout(async () => ({ status: 204, ok: true }), "https://x/y", {}, 1000);
  assert.equal(r.status, 204);
});

test("fetchWithTimeout: a network failure becomes { status: 0, reason: NETWORK }", async () => {
  const broken = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(
    fetchWithTimeout(broken, "https://x/y", {}, 1000),
    (e) => e.status === 0 && e.reason === "NETWORK" && /Failed to fetch/.test(e.message),
  );
});

test("isTransient: backend/device timeouts yes, client errors no", () => {
  for (const e of [{ status: 502 }, { status: 503 }, { status: 504 }, { status: 429 }, { status: 0, reason: "TIMEOUT" }]) {
    assert.equal(isTransient(e), true, JSON.stringify(e));
  }
  for (const e of [{ status: 401 }, { status: 403 }, { status: 404, reason: "NO_ACTIVE_DEVICE" }, { status: 0, reason: "NETWORK" }, null]) {
    assert.equal(isTransient(e), false, JSON.stringify(e));
  }
});

test("withRetry: one transient failure is retried, then the result comes back", async () => {
  let calls = 0;
  const v = await withRetry(async () => {
    calls += 1;
    if (calls === 1) throw { status: 503 };
    return "ok";
  }, { delayMs: 1 });
  assert.equal(v, "ok");
  assert.equal(calls, 2);
});

test("withRetry: a final error is thrown immediately", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw { status: 404, reason: "NO_ACTIVE_DEVICE" }; }, { delayMs: 1 }),
    (e) => e.status === 404,
  );
  assert.equal(calls, 1);
});

test("withRetry: retries: 0 disables retrying (non-idempotent POST next/previous)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => { calls += 1; throw { status: 503 }; }, { retries: 0, delayMs: 1 }),
    (e) => e.status === 503,
  );
  assert.equal(calls, 1);
});

test("withRetry: gives up after the retry budget and honours a delay function", async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(
    withRetry(async () => { calls += 1; throw { status: 429, retryAfterMs: 2 }; }, {
      delayMs: (e, attempt) => { delays.push([e.retryAfterMs, attempt]); return e.retryAfterMs; },
    }),
    (e) => e.status === 429,
  );
  assert.equal(calls, 2);
  assert.deepEqual(delays, [[2, 0]]);
});

test("createQueue: tasks run one at a time, in order, even after a failure", async () => {
  const q = createQueue();
  const log = [];
  const task = (name, ms, fail) => async () => {
    log.push(`${name}:start`);
    await sleep(ms);
    log.push(`${name}:end`);
    if (fail) throw new Error(name);
    return name;
  };
  const p1 = q.run(task("a", 30));
  const p2 = q.run(task("b", 5, true));
  const p3 = q.run(task("c", 5));
  assert.equal(q.busy, true);
  await assert.rejects(p2, /b/);
  assert.equal(await p1, "a");
  assert.equal(await p3, "c");
  assert.deepEqual(log, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
  assert.equal(q.busy, false);
});

test("waitFor: resolves with the first truthy probe value", async () => {
  let n = 0;
  const v = await waitFor(async () => (++n >= 3 ? { n } : null), { timeoutMs: 1000, stepMs: 5 });
  assert.deepEqual(v, { n: 3 });
});

test("waitFor: returns null at the deadline and swallows probe errors", async () => {
  let n = 0;
  const t0 = Date.now();
  const v = await waitFor(async () => { n += 1; throw new Error("read failed"); }, { timeoutMs: 40, stepMs: 10 });
  assert.equal(v, null);
  assert.ok(n >= 3, `expected several probes, got ${n}`);
  assert.ok(Date.now() - t0 >= 40);
});
