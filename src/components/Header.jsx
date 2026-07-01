import React from "react";
import { INK, MUTED } from "../theme.js";

// Title, dataset subtitle and the search/reset toolbar. The container is
// click-through (pointer-events none); inputs re-enable events so the map
// stays pannable everywhere around them.
export default function Header({
  isMobile, meta, genreCount, query, setQuery, legendOpen, setLegendOpen, onReset,
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: isMobile ? 12 : 28,
        left: isMobile ? 12 : 32,
        right: isMobile ? 12 : undefined,
        zIndex: 10,
        maxWidth: isMobile ? undefined : 360,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "'Spectral', serif",
          fontSize: isMobile ? 22 : 30,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          lineHeight: 1.05,
        }}
      >
        New Release Atlas
      </div>
      {!isMobile && (
        <div
          style={{
            fontSize: 12,
            color: MUTED,
            marginTop: 6,
          }}
        >
          {meta.unique_tracks} tracks · {meta.edges} links · {genreCount}{" "}
          genres · {meta.playlists} playlists ({meta.playlist_range})
          {meta.updated ? ` · updated ${meta.updated}` : ""}
        </div>
      )}

      <div
        style={{
          marginTop: isMobile ? 10 : 18,
          display: "flex",
          gap: 8,
          pointerEvents: "auto",
          width: isMobile ? "100%" : "fit-content",
        }}
      >
        <input
          className="mn-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search track or artist…"
          style={{
            flex: 1,
            minWidth: 0,
            padding: isMobile ? "10px 12px" : "8px 12px",
            fontSize: 13,
            background: "rgba(255,255,255,0.6)",
            border: `1px solid ${MUTED}`,
            borderRadius: 2,
            color: INK,
            transition: "border-color 0.2s",
          }}
        />
        {isMobile && (
          <button
            onClick={() => setLegendOpen((v) => !v)}
            aria-label="Toggle genre filter"
            style={{
              padding: "10px 12px",
              fontSize: 12,
              background: legendOpen ? "rgba(255,255,255,0.85)" : "transparent",
              border: `1px solid ${MUTED}`,
              borderRadius: 2,
              color: INK,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ⦿ Genres
          </button>
        )}
        <button
          onClick={onReset}
          style={{
            padding: isMobile ? "10px 14px" : "8px 14px",
            fontSize: 12,
            background: "transparent",
            border: `1px solid ${MUTED}`,
            borderRadius: 2,
            color: INK,
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
