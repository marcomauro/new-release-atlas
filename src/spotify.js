/* ----------------------------------------------------------------
   spotify.js — export di una playlist sull'account Spotify dell'utente,
   tutto lato browser con OAuth PKCE (NESSUN client secret, niente backend).

   Flusso:
   1. l'utente clicca "Salva su Spotify" su una playlist;
   2. se non c'e un token valido -> redirect a Spotify per il consenso
      (la playlist da creare e' messa in sospeso in sessionStorage);
   3. al ritorno (?code=...) handleRedirectCallback() scambia il code con un
      access token (PKCE) e si riprende l'export in sospeso;
   4. createPlaylistOnSpotify() crea la playlist privata e aggiunge i brani.

   Serve un Client ID Spotify (app gratuita su developer.spotify.com). NON e'
   un segreto: puo' stare nel codice o essere incollato in-app (localStorage).
   Il redirect URI registrato nell'app Spotify deve combaciare ESATTAMENTE con
   redirectUri() qui sotto.
   ---------------------------------------------------------------- */

const AUTHORIZE = "https://accounts.spotify.com/authorize";
const TOKEN = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";
const SCOPES = "playlist-modify-public playlist-modify-private";

// Opzionale: incolla qui il Client ID per cablarlo (resta pubblico, non e' un segreto).
const CONFIGURED_CLIENT_ID = "";

const LS_CLIENT = "nra_spotify_client_id";
const SS_VERIFIER = "nra_pkce_verifier";
const SS_STATE = "nra_oauth_state";
const SS_PENDING = "nra_pending_export";
const SS_TOKEN = "nra_spotify_token";

export function getClientId() {
  return CONFIGURED_CLIENT_ID || localStorage.getItem(LS_CLIENT) || "";
}
export function setClientId(id) {
  localStorage.setItem(LS_CLIENT, (id || "").trim());
}

// DEVE combaciare con il redirect URI registrato nell'app Spotify.
export function redirectUri() {
  return window.location.origin + import.meta.env.BASE_URL;
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(len = 64) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
async function challenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(digest);
}

export async function buildAuthUrl(clientId, pending) {
  const verifier = randomString(64);
  const code_challenge = await challenge(verifier);
  const state = randomString(16);
  sessionStorage.setItem(SS_VERIFIER, verifier);
  sessionStorage.setItem(SS_STATE, state);
  if (pending) sessionStorage.setItem(SS_PENDING, JSON.stringify(pending));
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge,
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE}?${p.toString()}`;
}

export async function beginAuth(clientId, pending) {
  window.location.assign(await buildAuthUrl(clientId, pending));
}

export function getStoredToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(SS_TOKEN) || "null");
    if (t && t.access_token && t.expires_at > Date.now() + 5000) return t.access_token;
  } catch {}
  return null;
}
export function takePending() {
  const raw = sessionStorage.getItem(SS_PENDING);
  if (!raw) return null;
  sessionStorage.removeItem(SS_PENDING);
  try { return JSON.parse(raw); } catch { return null; }
}

// Da chiamare al load: gestisce il ritorno da Spotify (?code=...).
export async function handleRedirectCallback(clientId) {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  if (!code && !err) return { status: "none" };
  const clean = window.location.origin + window.location.pathname;
  if (err) {
    window.history.replaceState({}, "", clean);
    return { status: "error", error: err };
  }
  const savedState = sessionStorage.getItem(SS_STATE);
  const verifier = sessionStorage.getItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_STATE);
  sessionStorage.removeItem(SS_VERIFIER);
  if (!verifier || state !== savedState) {
    window.history.replaceState({}, "", clean);
    return { status: "error", error: "state_mismatch" };
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  let res;
  try {
    res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    window.history.replaceState({}, "", clean);
    return { status: "error", error: "network" };
  }
  window.history.replaceState({}, "", clean);
  if (!res.ok) return { status: "error", error: "token_" + res.status };
  const data = await res.json();
  sessionStorage.setItem(
    SS_TOKEN,
    JSON.stringify({
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    })
  );
  return { status: "authed", token: data.access_token };
}

async function api(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch {}
    throw new Error(`${res.status}${detail ? " " + detail : ""}`);
  }
  return res.status === 204 ? null : res.json();
}

const toUri = (url) => {
  const m = /track\/([A-Za-z0-9]+)/.exec(url || "");
  return m ? "spotify:track:" + m[1] : null;
};

export async function createPlaylistOnSpotify(token, { name, description, trackUrls }) {
  const me = await api(token, "/me");
  const pl = await api(token, `/users/${me.id}/playlists`, {
    method: "POST",
    body: JSON.stringify({ name, description: description || "", public: false }),
  });
  const uris = (trackUrls || []).map(toUri).filter(Boolean);
  for (let i = 0; i < uris.length; i += 100) {
    await api(token, `/playlists/${pl.id}/tracks`, {
      method: "POST",
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
  return { url: pl.external_urls?.spotify, name: pl.name, added: uris.length };
}
