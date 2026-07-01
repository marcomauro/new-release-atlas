import React from "react";
import WeightControls from "../WeightControls.jsx";
import { GENRE_LABEL } from "../playlist.js";
import { INK, MUTED, PAPER, gColor } from "../theme.js";

// Mood parameters (0–1) rendered as bars in the "Mood & audio" section.
const MOOD_PARAMS = [
  ["energy", "Energy"],
  ["valence", "Valence"],
  ["danceability", "Danceability"],
  ["acousticness", "Acousticness"],
  ["instrumentalness", "Instrumental"],
];

// Track detail card — docked on desktop, a bottom sheet on mobile. Shows the
// selected track's genres/metadata, the collapsible mood/audio section, the
// action row (Spotify / generate playlist / weights) and, when no route is
// playing, the single-track Spotify embed.
export default function DetailPanel({
  track, onClose, isMobile,
  // bottom padding reservation for the mobile mini-player
  reserveBottom,
  // collapsible sections
  moodOpen, setMoodOpen, weightsOpen, setWeightsOpen,
  // playlist generation + weight controls wiring
  onGenerate, showEmbed,
  weights, setWeights, randomness, setRandomness, mood, setMood,
  liveRegen, setLiveRegen, onRegenerate, canRegenerate,
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: isMobile ? undefined : 28,
        right: isMobile ? 0 : 28,
        bottom: isMobile ? 0 : undefined,
        left: isMobile ? 0 : undefined,
        zIndex: 40,
        width: isMobile ? "auto" : 340,
        maxWidth: isMobile ? undefined : "calc(100vw - 56px)",
        boxSizing: "border-box",
        maxHeight: isMobile ? "70dvh" : undefined,
        overflowY: isMobile ? "auto" : undefined,
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(10px)",
        border: `1px solid ${MUTED}`,
        borderRadius: isMobile ? "14px 14px 0 0" : 3,
        padding: isMobile ? "18px 20px 0" : "20px 22px",
        // on mobile reserve room at the bottom for the active player, so the
        // buttons/content don't end up covered by the mini-player.
        paddingBottom: isMobile
          ? `calc(${reserveBottom}px + env(safe-area-inset-bottom))`
          : undefined,
        boxShadow: isMobile ? "0 -8px 30px rgba(0,0,0,0.16)" : "0 8px 30px rgba(0,0,0,0.08)",
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          width: 30,
          height: 30,
          lineHeight: "28px",
          textAlign: "center",
          fontSize: 15,
          background: "transparent",
          border: `1px solid rgba(154,147,138,0.5)`,
          borderRadius: "50%",
          color: MUTED,
          cursor: "pointer",
        }}
      >
        ✕
      </button>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", paddingRight: 34 }}>
        {track.genres.map((g) => (
          <span
            key={g}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 10,
              background: gColor(g),
              color: "#fff",
              letterSpacing: "0.02em",
            }}
          >
            {GENRE_LABEL[g] || g}
          </span>
        ))}
      </div>
      <div
        style={{
          fontFamily: "'Spectral', serif",
          fontSize: 19,
          fontWeight: 500,
          lineHeight: 1.2,
        }}
      >
        {track.title}
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        {track.artists.join(", ")}
      </div>
      <div
        style={{
          fontSize: 11,
          color: MUTED,
          marginTop: 14,
          lineHeight: 1.7,
        }}
      >
        Duration {track.duration} · {track.degree} links
        {track.bpm != null && <> · {track.bpm} BPM</>}
        <br />
        Playlists {track.playlists.map((p) => "#" + p).join(", ")}
      </div>

      {/* Mood + parameters + subgenres — hidden by default, opens on demand
          so the card doesn't get crowded. */}
      {(track.mood?.length ||
        track.subgenres?.length ||
        MOOD_PARAMS.some(([k]) => track[k] != null)) && (
        <div style={{ marginTop: 14 }}>
          <button
            onClick={() => setMoodOpen((v) => !v)}
            style={{
              fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
              color: MUTED, background: "transparent", border: "none",
              padding: 0, cursor: "pointer",
            }}
          >
            {moodOpen ? "▾" : "▸"} Mood & audio
          </button>
          {moodOpen && (
          <div style={{ marginTop: 10 }}>
          {track.mood?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {track.mood.map((m) => (
                <span
                  key={m}
                  style={{
                    fontSize: 10,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: "rgba(43,39,36,0.06)",
                    color: INK,
                    border: `1px solid rgba(154,147,138,0.45)`,
                    letterSpacing: "0.02em",
                  }}
                >
                  {m}
                </span>
              ))}
            </div>
          )}
          {MOOD_PARAMS.map(([key, label]) =>
            track[key] != null ? (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
                <span
                  style={{
                    fontSize: 9.5,
                    color: MUTED,
                    width: 104,
                    whiteSpace: "nowrap",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </span>
                <div style={{ flex: 1, height: 5, background: "rgba(154,147,138,0.25)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round(track[key] * 100)}%`, height: "100%", background: INK }} />
                </div>
                <span style={{ fontSize: 10, color: MUTED, width: 22, textAlign: "right" }}>
                  {Math.round(track[key] * 100)}
                </span>
              </div>
            ) : null
          )}
          {track.subgenres?.length > 0 && (
            <div style={{ fontSize: 11, color: MUTED, marginTop: 12, lineHeight: 1.5 }}>
              {track.subgenres.join(" · ")}
            </div>
          )}
          </div>
          )}
        </div>
      )}
      {/* Actions: on mobile they fit a single row (compact labels). */}
      <div style={{ display: "flex", gap: isMobile ? 6 : 8, marginTop: 16, flexWrap: isMobile ? "nowrap" : "wrap" }}>
        <a
          href={track.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            flex: isMobile ? 1 : undefined, minWidth: 0,
            textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontSize: 12, color: PAPER, background: INK,
            padding: isMobile ? "9px 8px" : "7px 14px",
            borderRadius: 2, textDecoration: "none",
          }}
        >
          {isMobile ? "Spotify ↗" : "Open in Spotify ↗"}
        </a>
        <button
          onClick={() => onGenerate(track)}
          title="Build a playlist from this track's graph connections"
          style={{
            flex: isMobile ? 1 : undefined, minWidth: 0,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontSize: 12, color: INK, background: "transparent",
            border: `1px solid ${INK}`,
            padding: isMobile ? "9px 8px" : "7px 14px",
            borderRadius: 2, cursor: "pointer",
          }}
        >
          {isMobile ? "♫ Generate" : "♫ Generate playlist"}
        </button>
        <button
          onClick={() => setWeightsOpen((v) => !v)}
          title="Adjust the link weights used to build the route"
          style={{
            flex: isMobile ? "0 0 auto" : undefined,
            fontSize: 12, color: INK, background: weightsOpen ? "rgba(43,39,36,0.08)" : "transparent",
            border: `1px solid ${MUTED}`,
            padding: isMobile ? "9px 11px" : "7px 12px",
            borderRadius: 2, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {isMobile ? "⚖" : "⚖ weights"}
        </button>
      </div>

      {weightsOpen && (
        <div style={{ marginTop: 12 }}>
          <WeightControls
            weights={weights} setWeights={setWeights}
            randomness={randomness} setRandomness={setRandomness}
            mood={mood} setMood={setMood}
            liveRegen={liveRegen} setLiveRegen={setLiveRegen}
            onRegenerate={onRegenerate} canRegenerate={canRegenerate}
          />
        </div>
      )}
      {/* Single-track Spotify player (~30s preview for everyone, full track
          for logged-in Premium). Hidden while a route is playing: the route's
          mini-player owns the audio then (no double playback). */}
      {showEmbed && (
        <iframe
          title="Spotify player"
          src={`https://open.spotify.com/embed/track/${track.id}?utm_source=new-release-atlas`}
          width="100%"
          height="80"
          frameBorder="0"
          loading="lazy"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          style={{ border: 0, borderRadius: 8, marginTop: 16, display: "block" }}
        />
      )}
    </div>
  );
}
