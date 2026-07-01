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

export const gColor = (g) => GENRE_COLOR[g] || MUTED;
