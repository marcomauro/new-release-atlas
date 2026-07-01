import React from "react";
import { GENRE_LABEL } from "../playlist.js";
import { INK, MUTED, PAPER, gColor } from "../theme.js";

// Small always-on overlays around the map: usage hints (desktop only),
// credits, and the hover tooltip.

export function MapHints() {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        left: 32,
        zIndex: 10,
        fontSize: 11,
        color: MUTED,
        lineHeight: 1.6,
      }}
    >
      Click a node to isolate its links · drag to reposition
      <br />
      scroll to zoom · clusters are the inferred genres
    </div>
  );
}

// Credits — bottom-right, discreet. On mobile they're hidden while the player
// is active or the chat is open, so they don't overlap the bottom bar.
export function Credits({ isMobile }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: `calc(8px + env(safe-area-inset-bottom))`,
        right: isMobile ? 12 : 32,
        zIndex: 10,
        fontSize: 10.5,
        color: MUTED,
        textAlign: "right",
        lineHeight: 1.5,
        pointerEvents: "auto",
      }}
    >
      by Marco Mauro ·{" "}
      <a
        href="https://github.com/marcomauro/new-release-atlas"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: INK, textDecoration: "none", borderBottom: `1px solid ${MUTED}` }}
      >
        source on GitHub
      </a>
      <br />
      built with Claude by Anthropic
    </div>
  );
}

// Dark tooltip with title/artist/genre for the hovered node (desktop only).
export function HoverCard({ track }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 24,
        right: 28,
        zIndex: 15,
        background: "rgba(43,39,36,0.92)",
        color: PAPER,
        padding: "8px 14px",
        borderRadius: 2,
        fontSize: 12,
        maxWidth: 260,
      }}
    >
      <span style={{ fontFamily: "'Spectral', serif", fontWeight: 500 }}>
        {track.title}
      </span>
      <span style={{ opacity: 0.7 }}> — {track.artist}</span>
      <span
        style={{
          display: "block",
          marginTop: 2,
          fontSize: 10,
          color: gColor(track.genre),
        }}
      >
        ● {GENRE_LABEL[track.genre] || track.genre}
      </span>
    </div>
  );
}
