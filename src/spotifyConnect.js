// Spotify Connect — login OAuth (Authorization Code + PKCE, 100% client-side,
// nessun secret) e controllo della riproduzione sul device Spotify dell'utente
// via Web API. Serve a riprodurre i brani INTERI (Premium) anche su mobile:
// la nostra app fa da telecomando, l'audio esce dall'app Spotify.

import {
  fetchWithTimeout, withRetry, createQueue, waitFor, sleep,
  REQUEST_TIMEOUT_MS, COMMAND_TIMEOUT_MS,
} from "./connectTransport.js";

const CLIENT_ID = "90be0fb998cf44b3b3b6560cfd52c5d5";
const SCOPES = "user-modify-playback-state user-read-playback-state";
const REDIRECT_URI =
  typeof window !== "undefined" ? window.location.origin + import.meta.env.BASE_URL : "";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const API = "https://api.spotify.com/v1";

const LS_TOKENS = "sp_tokens";
const LS_VERIFIER = "sp_pkce_verifier";
const LS_STATE = "sp_oauth_state";
const LS_PENDING = "sp_pending_play"; // percorso da riprendere dopo il redirect

// ---- util PKCE ----
function randomString(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => ("0" + b.toString(16)).slice(-2)).join("");
}
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
async function challenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest);
}

// ---- token storage ----
function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(LS_TOKENS) || "null");
  } catch (e) {
    return null;
  }
}
function writeTokens(t) {
  localStorage.setItem(LS_TOKENS, JSON.stringify(t));
}
export function isSpotifyLoggedIn() {
  const t = readTokens();
  return !!(t && t.refresh_token);
}

// ---- pending play (sopravvive al redirect di login) ----
export function setPendingPlay(ids) {
  try {
    localStorage.setItem(LS_PENDING, JSON.stringify(ids || []));
  } catch (e) { /* noop */ }
}
export function takePendingPlay() {
  try {
    const v = localStorage.getItem(LS_PENDING);
    localStorage.removeItem(LS_PENDING);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

// ---- login ----
export async function loginSpotify() {
  const verifier = randomString(48); // 96 hex chars (range valido 43-128)
  const state = randomString(8);
  localStorage.setItem(LS_VERIFIER, verifier);
  localStorage.setItem(LS_STATE, state);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: await challenge(verifier),
    scope: SCOPES,
    state,
  });
  window.location.href = `${AUTH_URL}?${params.toString()}`;
}

// Da chiamare all'avvio: se torniamo dal redirect con ?code, scambia il token.
// Restituisce true se ha appena completato il login.
export async function completeSpotifyAuthIfNeeded() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return false;
  const expected = localStorage.getItem(LS_STATE);
  const verifier = localStorage.getItem(LS_VERIFIER);
  // pulisci sempre la query, anche in caso di errore
  const clean = () => {
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    window.history.replaceState({}, "", url.toString());
  };
  if (!verifier || (expected && state !== expected)) {
    clean();
    return false;
  }
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) {
      clean();
      return false;
    }
    writeTokens({
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      scope: j.scope || "",
    });
    localStorage.removeItem(LS_VERIFIER);
    localStorage.removeItem(LS_STATE);
    clean();
    return true;
  } catch (e) {
    clean();
    return false;
  }
}

async function getValidToken() {
  const t = readTokens();
  if (!t || !t.access_token) return null;
  if (Date.now() < (t.expires_at || 0) - 60000) return t.access_token;
  // refresh
  if (!t.refresh_token) return null;
  try {
    const body = new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    });
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const j = await r.json();
    if (!r.ok || !j.access_token) return null;
    writeTokens({
      access_token: j.access_token,
      refresh_token: j.refresh_token || t.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000,
      scope: j.scope || t.scope || "",
    });
    return j.access_token;
  } catch (e) {
    return null;
  }
}

// Optional console tracing of every Connect request — method, path, status,
// elapsed ms. Run `localStorage.nra_debug = "1"` in the browser console and
// reload; handy to see from the iMac which command the desktop app sits on.
function debugOn() {
  try { return localStorage.getItem("nra_debug") === "1"; } catch (e) { return false; }
}

// Generic Web API call. Throws { status, reason, message } on errors; a
// request that never completes throws status 0 with reason TIMEOUT or NETWORK
// instead of pending forever. Idempotent methods get ONE retry on a transient
// failure (502/503/504/429/timeout): a replayed PUT — play, pause, transfer,
// seek — is harmless, a replayed POST (next/previous) would skip two tracks.
async function apiCall(path, method = "GET", body, { timeoutMs = REQUEST_TIMEOUT_MS, retries } = {}) {
  const token = await getValidToken();
  if (!token) throw { status: 401, reason: "NO_AUTH" };
  const budget = retries != null ? retries : method === "POST" ? 0 : 1;
  return withRetry(async (attempt) => {
    const t0 = Date.now();
    const trace = (outcome) => {
      if (!debugOn()) return;
      console.debug(`[connect] ${method} ${path} → ${outcome} in ${Date.now() - t0} ms${attempt ? ` (retry ${attempt})` : ""}`);
    };
    let r;
    try {
      r = await fetchWithTimeout((u, init) => fetch(u, init), API + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }, timeoutMs);
    } catch (e) {
      trace(e.reason);
      throw e;
    }
    trace(r.status);
    if (r.status === 204) return null;
    let data = null;
    try { data = await r.json(); } catch (e) { /* no body */ }
    if (!r.ok) {
      const err = { status: r.status, reason: data && data.error && data.error.reason, message: data && data.error && data.error.message };
      // 429 carries the wait the backend asks for (seconds); cap it.
      if (r.status === 429) err.retryAfterMs = Math.min(5000, (Number(r.headers.get("Retry-After")) || 1) * 1000);
      throw err;
    }
    return data;
  }, { retries: budget, delayMs: (e) => e.retryAfterMs || 1200 });
}

// ---- reads (bypass the command queue) ----

export async function spotifyDevices() {
  const d = await apiCall("/me/player/devices");
  return (d && d.devices) || [];
}

// Full player state: device, progress_ms, item (album.images, duration_ms),
// is_playing, shuffle_state, repeat_state. 204 (nothing active) -> null.
export async function spotifyState() {
  return apiCall("/me/player");
}

// ---- commands ----
// Every MUTATING command goes through ONE serial queue: the desktop client
// freezes when play / transfer / pause reach it while it is still switching
// context, so each command waits for the previous one to settle (or time
// out). Module-level, so it also orders commands across player remounts: the
// pause sent by a closing player cannot overtake the play of the next one.
const queue = createQueue();
export const connectBusy = () => queue.busy;

// Raw (unqueued) commands, composed by spotifyStartOn below.
const putTransfer = (deviceId, play) =>
  apiCall("/me/player", "PUT", { device_ids: [deviceId], play }, { timeoutMs: COMMAND_TIMEOUT_MS });
const putPlay = (uris, offset, deviceId) =>
  apiCall("/me/player/play" + (deviceId ? `?device_id=${deviceId}` : ""), "PUT",
    { uris, offset: { position: offset } }, { timeoutMs: COMMAND_TIMEOUT_MS });

export function spotifyTransfer(deviceId, play = true) {
  return queue.run(() => putTransfer(deviceId, play));
}

// Plays the URI list from `offset` (full tracks, continuous) on `deviceId`.
export function spotifyPlay(uris, offset = 0, deviceId) {
  return queue.run(() => putPlay(uris, offset, deviceId));
}

// Start a route on `device` the way the clients tolerate it:
//   1. if the device is not the active one, make it active with a transfer
//      WITHOUT autoplay and wait until /me/player actually reports it (the
//      backend acks the transfer before the client has finished switching);
//   2. only then send play with the explicit device_id.
// Firing play?device_id straight at an inactive client asks it to wake up,
// switch and load a whole queue in one shot — the sequence that hangs the
// desktop app on macOS. An already-active device (the phone in your hand)
// skips step 1: no added latency there.
export function spotifyStartOn(device, uris, offset = 0) {
  return queue.run(async () => {
    if (!device.is_active) {
      await putTransfer(device.id, false);
      const seen = await waitFor(async () => {
        const c = await spotifyState();
        return c && c.device && c.device.id === device.id ? c : null;
      }, { timeoutMs: 4000, stepMs: 400 });
      // Short settle even once the switch is reported: the client is still
      // tearing down its previous context. If it never reported in time we
      // still try the explicit play — it is the best remaining shot.
      if (seen) await sleep(300);
    }
    await putPlay(uris, offset, device.id);
  });
}

export function spotifyPause() {
  return queue.run(() => apiCall("/me/player/pause", "PUT"));
}
export function spotifyResume() {
  return queue.run(() => apiCall("/me/player/play", "PUT"));
}
export function spotifyNext() {
  return queue.run(() => apiCall("/me/player/next", "POST"));
}
export function spotifyPrevious() {
  return queue.run(() => apiCall("/me/player/previous", "POST"));
}
export function spotifySeek(ms) {
  return queue.run(() => apiCall(`/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}`, "PUT"));
}
export function spotifyShuffle(state) {
  return queue.run(() => apiCall(`/me/player/shuffle?state=${state ? "true" : "false"}`, "PUT"));
}
// state: "off" | "context" | "track"
export function spotifyRepeat(state) {
  return queue.run(() => apiCall(`/me/player/repeat?state=${state}`, "PUT"));
}
