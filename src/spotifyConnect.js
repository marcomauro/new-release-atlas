// Spotify Connect — login OAuth (Authorization Code + PKCE, 100% client-side,
// nessun secret) e controllo della riproduzione sul device Spotify dell'utente
// via Web API. Serve a riprodurre i brani INTERI (Premium) anche su mobile:
// la nostra app fa da telecomando, l'audio esce dall'app Spotify.

const CLIENT_ID = "90be0fb998cf44b3b3b6560cfd52c5d5";
const SCOPES =
  "user-modify-playback-state user-read-playback-state " +
  "user-library-read user-library-modify " +
  "playlist-modify-private playlist-modify-public";
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
export function logoutSpotify() {
  localStorage.removeItem(LS_TOKENS);
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
    // Forza la schermata di consenso: senza questo, se l'app era gia'
    // autorizzata con scope piu' ristretti, Spotify ri-rilascia un token con i
    // SOLI scope vecchi e i nuovi (library/playlist) non vengono mai concessi
    // -> il "Reconnect" andrebbe in loop. Con show_dialog l'utente ri-approva.
    show_dialog: "true",
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
    });
    return j.access_token;
  } catch (e) {
    return null;
  }
}

// chiamata generica all'API; lancia { status, reason } sugli errori
async function apiCall(path, method = "GET", body) {
  const token = await getValidToken();
  if (!token) throw { status: 401, reason: "NO_AUTH" };
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  let data = null;
  try { data = await r.json(); } catch (e) { /* no body */ }
  if (!r.ok) {
    throw { status: r.status, reason: data && data.error && data.error.reason, message: data && data.error && data.error.message };
  }
  return data;
}

export async function spotifyDevices() {
  const d = await apiCall("/me/player/devices");
  return (d && d.devices) || [];
}

export async function spotifyTransfer(deviceId, play = true) {
  return apiCall("/me/player", "PUT", { device_ids: [deviceId], play });
}

// Riproduce la lista di URI a partire da `offset` (full track, continuo).
export async function spotifyPlay(uris, offset = 0, deviceId) {
  const path = "/me/player/play" + (deviceId ? `?device_id=${deviceId}` : "");
  return apiCall(path, "PUT", { uris, offset: { position: offset } });
}
export async function spotifyPause() {
  return apiCall("/me/player/pause", "PUT");
}
export async function spotifyResume() {
  return apiCall("/me/player/play", "PUT");
}
export async function spotifyCurrentlyPlaying() {
  return apiCall("/me/player/currently-playing");
}

// Stato completo del player: device, progress_ms, item (con album.images +
// duration_ms), is_playing, shuffle_state, repeat_state. 204 -> null.
export async function spotifyState() {
  return apiCall("/me/player");
}
export async function spotifyNext() {
  return apiCall("/me/player/next", "POST");
}
export async function spotifyPrevious() {
  return apiCall("/me/player/previous", "POST");
}
export async function spotifySeek(ms) {
  return apiCall(`/me/player/seek?position_ms=${Math.max(0, Math.round(ms))}`, "PUT");
}
export async function spotifyShuffle(state) {
  return apiCall(`/me/player/shuffle?state=${state ? "true" : "false"}`, "PUT");
}
// state: "off" | "context" | "track"
export async function spotifyRepeat(state) {
  return apiCall(`/me/player/repeat?state=${state}`, "PUT");
}

// ---- libreria / playlist (richiedono gli scope library/playlist) ----
export async function spotifyTracksSaved(ids) {
  const d = await apiCall(`/me/tracks/contains?ids=${ids.join(",")}`);
  return d || [];
}
export async function spotifySaveTrack(id) {
  return apiCall(`/me/tracks?ids=${id}`, "PUT");
}
export async function spotifyRemoveTrack(id) {
  return apiCall(`/me/tracks?ids=${id}`, "DELETE");
}
export async function spotifyMe() {
  return apiCall("/me");
}
// Crea una playlist (privata) con l'elenco di URI; ritorna { id, url }.
export async function spotifyCreatePlaylist(name, uris, description = "") {
  const me = await spotifyMe();
  const pl = await apiCall(`/users/${me.id}/playlists`, "POST", {
    name,
    public: false,
    description,
  });
  for (let i = 0; i < uris.length; i += 100) {
    await apiCall(`/playlists/${pl.id}/tracks`, "POST", { uris: uris.slice(i, i + 100) });
  }
  return {
    id: pl.id,
    url: (pl.external_urls && pl.external_urls.spotify) || `https://open.spotify.com/playlist/${pl.id}`,
  };
}
