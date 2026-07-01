import React from "react";
import { GENRE_LABEL } from "../playlist.js";
import { INK, MUTED, gColor } from "../theme.js";

// Genre legend / filter. The container is click-through on desktop; only the
// rows catch clicks. On mobile it's a toggleable frosted card so it doesn't
// bury the map.
export default function Legend({
  isMobile, genres, genreCounts, activeGenre, setActiveGenre,
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: isMobile ? 92 : 150,
        left: isMobile ? 12 : 32,
        right: isMobile ? 12 : undefined,
        zIndex: 10,
        width: isMobile ? "auto" : "fit-content",
        maxWidth: isMobile ? undefined : 220,
        maxHeight: isMobile ? "52dvh" : undefined,
        overflowY: isMobile ? "auto" : undefined,
        pointerEvents: isMobile ? "auto" : "none",
        background: isMobile ? "rgba(255,255,255,0.72)" : "transparent",
        backdropFilter: isMobile ? "blur(10px)" : undefined,
        border: isMobile ? `1px solid ${MUTED}` : undefined,
        borderRadius: isMobile ? 6 : undefined,
        padding: isMobile ? "10px 12px" : undefined,
        boxShadow: isMobile ? "0 10px 30px rgba(0,0,0,0.12)" : undefined,
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: MUTED,
          marginBottom: 8,
        }}
      >
        Genres — {isMobile ? "tap" : "click"} to filter
      </div>
      {genres.map((g) => {
        const active = activeGenre === g;
        return (
          <div
            key={g}
            className="mn-chip"
            onClick={() => setActiveGenre(active ? null : g)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: isMobile ? "8px 8px" : "3px 6px",
              marginBottom: 1,
              width: isMobile ? "100%" : "fit-content",
              cursor: "pointer",
              pointerEvents: "auto",
              borderRadius: 2,
              background: active ? "rgba(255,255,255,0.7)" : "transparent",
              opacity: activeGenre && !active ? 0.4 : 1,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: gColor(g),
                flexShrink: 0,
                border: active ? `1.5px solid ${INK}` : "none",
              }}
            />
            <span style={{ fontSize: isMobile ? 13 : 12, minWidth: isMobile ? 0 : 120, flex: isMobile ? 1 : undefined }}>{GENRE_LABEL[g] || g}</span>
            <span style={{ fontSize: 11, color: MUTED, marginLeft: "auto" }}>
              {genreCounts[g]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
