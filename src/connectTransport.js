// Transport layer shared by every Spotify Connect command: request deadline,
// retry policy for transient backend errors, a serial command queue and a
// "wait until" poller. Pure module — no DOM, no Vite globals — so it runs
// under `node --test` (tests/connect_transport.test.mjs).
//
// Why this exists: the Connect backend acks a command only once the target
// device has answered. A desktop client that is waking up (macOS App Nap, a
// context switch in progress) can hold that answer for a long time, or never
// give it. Without a deadline the request pends forever and the UI stays
// optimistic; without serialization the next command lands on a client that
// is still busy with the previous one — the sequence that freezes it.

// Reads and light commands.
export const REQUEST_TIMEOUT_MS = 8000;
// Play / transfer legitimately take longer while a device switches context.
export const COMMAND_TIMEOUT_MS = 10000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch with a deadline. Resolves like fetch; rejects with
// { status: 0, reason: "TIMEOUT" } once `timeoutMs` has passed, or with
// { status: 0, reason: "NETWORK" } when the request failed outright — the
// same { status, reason } shape the API layer throws for HTTP errors.
export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) {
      throw { status: 0, reason: "TIMEOUT", message: `no answer within ${timeoutMs} ms` };
    }
    throw { status: 0, reason: "NETWORK", message: (e && e.message) || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Transient failures worth a retry: 502/503/504 (the backend could not reach
// the device in time), 429 (rate limited, carries retryAfterMs) and our own
// timeout. Anything else — 401, 403, 404, a network error — is final.
export function isTransient(err) {
  if (!err) return false;
  return err.reason === "TIMEOUT" || err.status === 429 || err.status === 502
    || err.status === 503 || err.status === 504;
}

// Runs `fn(attempt)` again — once by default — after a transient failure.
// Only for idempotent commands: replaying a PUT (play / pause / transfer /
// seek) is harmless, replaying a POST (next / previous) would skip two tracks.
// `delayMs` may be a function of (error, attempt), e.g. to honour Retry-After.
export async function withRetry(fn, { retries = 1, delayMs = 1200, shouldRetry = isTransient } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= retries || !shouldRetry(e)) throw e;
      await sleep(typeof delayMs === "function" ? delayMs(e, attempt) : delayMs);
    }
  }
}

// Serial queue: tasks run one at a time, in submission order, each one
// starting only after the previous has settled (fulfilled, rejected or timed
// out). `busy` is true while anything is queued or running.
export function createQueue() {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    run(fn) {
      pending += 1;
      const p = tail.then(() => fn(), () => fn()); // run regardless of the previous outcome
      tail = p.then(() => {}, () => {});
      return p.finally(() => { pending -= 1; });
    },
    get busy() { return pending > 0; },
  };
}

// Polls `probe` every `stepMs` until it returns a truthy value or the
// deadline passes. Resolves to that value, or to null at the deadline (after
// one last probe). Probe errors are swallowed: a transient read failure must
// not abort the wait.
export async function waitFor(probe, { timeoutMs = 4000, stepMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let v = null;
    try { v = await probe(); } catch (e) { /* keep waiting */ }
    if (v) return v;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await sleep(Math.min(stepMs, left));
  }
}
