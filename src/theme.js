// Shared visual constants — the single source of truth for the app's palette.
// Imported by the map, the chat, the weight controls and the player, which
// used to each carry their own copy of these values.

// Genre palette — each genre its own hue, editorial / muted.
export const GENRE_COLOR = {
  "neo-soul": "#c75b4a",
  "electronic": "#3a7d8c",
  "jazz": "#d39a3e",
  "alt": "#8a6d9e",
  "uk-jazz": "#6b8e5a",
  "hip-hop": "#b5697e",
  "world": "#bf8b4a",
  "soulful-house": "#4f9e9e",
  "soul-funk": "#9e6b52",
  "broken-beat": "#7d8c4f",
  "downtempo": "#5b6b9e",
  "classical": "#7a8aa0",
  "unknown": "#b8b0a4",
};

export const INK = "#2b2724";
export const PAPER = "#f4f1ea";
export const MUTED = "#9a938a";
// "Active" accent: used both for the selected-track halo and for the route
// line. Bright azure -> azure = whatever is active / playing.
export const ACCENT = "#1fb6e8";

// Deterministic fallback colour for genres OUTSIDE the hand-picked palette:
// a muted, editorial hue derived from the slug's hash. A newly adopted genre
// is born distinguishable on the map (cluster, legend, chips) instead of
// grey; the add_playlist WARN stays as the reminder to pick a definitive
// colour here and a label/synonyms in playlist.js.
const _autoColor = new Map();
function autoColor(g) {
  if (!g) return MUTED;
  let c = _autoColor.get(g);
  if (!c) {
    let h = 0;
    for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) | 0;
    // saturation/lightness sit in the same range as the curated palette
    c = `hsl(${(h >>> 0) % 360}, 38%, 52%)`;
    _autoColor.set(g, c);
  }
  return c;
}

export const gColor = (g) => GENRE_COLOR[g] || autoColor(g);
