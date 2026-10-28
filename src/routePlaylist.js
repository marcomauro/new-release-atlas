// The route is played on Spotify from ONE private playlist in the user's
// account ("Atlas · now playing"), overwritten on every start, instead of a
// bare list of track URIs. Pure helpers — no DOM, no Vite globals — so they
// run under `node --test` (tests/route_playlist.test.mjs).
//
// Why: PUT /me/player/play with `uris` is acked (204) but the clients — the
// macOS desktop app and the phone alike — no longer load it: they end up
// "active" with no track and every action disallowed, and the music stops.
// The same tracks played as a playlist `context_uri` start at once, keep
// their order, and next / previous / shuffle / repeat behave like any
// Spotify playlist.

export const ROUTE_PLAYLIST_NAME = "Atlas · now playing";
export const ROUTE_PLAYLIST_DESCRIPTION =
  "The route playing from New Release Atlas — rewritten every time a route starts.";

// Scope needed to write the route playlist (private, owned by the user).
export const ROUTE_PLAYLIST_SCOPE = "playlist-modify-private";

// Max URIs per playlist write request (Web API limit).
export const PLAYLIST_WRITE_MAX = 100;

export function hasScope(granted, scope) {
  return String(granted || "").split(/\s+/).includes(scope);
}

export function chunk(list, size = PLAYLIST_WRITE_MAX) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Among the user's playlists (GET /me/playlists items), the route playlist
// this account already owns — so a second browser or the phone reuses it
// instead of piling up copies. Null when there is none.
export function findRoutePlaylist(items, userId) {
  return (items || []).find((p) =>
    p && p.name === ROUTE_PLAYLIST_NAME && p.owner && p.owner.id === userId) || null;
}
