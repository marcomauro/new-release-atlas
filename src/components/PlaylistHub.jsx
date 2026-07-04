import React, { useRef, useState } from "react";
import WeightControls from "../WeightControls.jsx";
import { INK, PAPER, MUTED } from "../theme.js";

const SUGGESTIONS = [
  "relaxing jazz, 15 tracks",
  "soulful house for the party",
  "like Moodymann",
  "mix neo-soul and uk jazz",
  "surprise me",
];

const font = "Inter, system-ui, sans-serif";

// Playlist Hub — the panel behind the "Playlist" launcher. Replaces the old
// chat-thread UI with three zones, each with a single job:
//   1. prompt bar (ask): input + always-visible suggestion chips;
//   2. ACTIVE playlist card (the one drawn on the map): title, note, ALL of
//      its actions together (Play / Regenerate / Tune / Export) and the
//      tracklist. The weights panel opens inline here — single entry point;
//   3. compact history: previous generations as one-line rows with Restore.
// The engine (playlist.js) is prompt-in → playlist-out, not conversational,
// so the UI no longer pretends to be a chat.
export default function PlaylistHub({
  open, setOpen, value, onChange, onSubmit,
  active, history, notice,
  onPick, onPlay, onExport, onRegenerate, onRestore,
  genreColor, bottomOffset = 0,
  weights, setWeights, randomness, setRandomness, mood, setMood,
  liveRegen, setLiveRegen,
}) {
  const [tuneOpen, setTuneOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const listRef = useRef(null);

  const submit = (e) => {
    e.preventDefault();
    const t = (value || "").trim();
    if (t) onSubmit(t);
  };

  if (!open) {
    const label = active ? `♫ ${truncate(active.res.theme, 26)}` : "Playlist";
    return (
      <button
        onClick={() => setOpen(true)}
        title={active ? "Reopen the playlist panel" : "Build a playlist from the graph"}
        style={{
          position: "absolute", bottom: `calc(${24 + bottomOffset}px + env(safe-area-inset-bottom))`, left: "50%",
          transform: "translateX(-50%)", zIndex: 30,
          fontFamily: font, fontSize: 14, fontWeight: 500,
          color: PAPER, background: INK, border: "none",
          padding: "11px 23px", borderRadius: 23, cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
          maxWidth: "86vw", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          textTransform: active ? "capitalize" : "none",
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="mn-chat"
      style={{
        position: "absolute", bottom: `calc(${20 + bottomOffset}px + env(safe-area-inset-bottom))`, left: "50%",
        transform: "translateX(-50%)", zIndex: 30,
        width: "min(580px, 94vw)",
        // Height cap: the panel (anchored at the bottom) must never exceed the
        // viewport, or the header with ✕ escapes above the screen. The
        // tracklist and history compress/scroll instead.
        maxHeight: `calc(100dvh - ${32 + bottomOffset}px - env(safe-area-inset-bottom))`,
        fontFamily: font,
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(10px)",
        border: `1px solid ${MUTED}`, borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0,0,0,0.16)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* ---- header ---- */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
          padding: "10px 14px", borderBottom: `1px solid rgba(154,147,138,0.3)`,
        }}
      >
        <span style={{ fontFamily: "'Spectral', serif", fontSize: 15, fontWeight: 500, color: INK }}>
          ♫ Playlist from the graph
        </span>
        <span style={{ fontSize: 11, color: MUTED }}>— describe what you want to hear</span>
        <button onClick={() => setOpen(false)} title="Close" style={{ ...iconBtn, marginLeft: "auto" }}>
          ✕
        </button>
      </div>

      {/* ---- zone 1: prompt bar ---- */}
      <div style={{ padding: "10px 14px 8px", flexShrink: 0, borderBottom: `1px solid rgba(154,147,138,0.3)` }}>
        <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. groovy soul-funk, 10 tracks"
            style={{
              flex: 1, fontFamily: font, fontSize: 13, color: INK,
              border: `1px solid ${MUTED}`, borderRadius: 6, padding: "8px 10px",
              background: "rgba(255,255,255,0.7)", outline: "none",
            }}
          />
          <button type="submit" style={{ fontFamily: font, fontSize: 13, fontWeight: 500, color: PAPER, background: INK, border: "none", borderRadius: 6, padding: "0 16px", cursor: "pointer" }}>
            Generate
          </button>
        </form>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => onSubmit(s)} style={chip}>
              {s}
            </button>
          ))}
        </div>
        {/* errors (e.g. prompt not understood) surface here, next to the ask */}
        {notice && !active && <Notice notice={notice} />}
      </div>

      {/* ---- zone 2: ACTIVE playlist card ---- */}
      {active ? (
        <div style={{ padding: "10px 14px", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase", color: MUTED, marginBottom: 4 }}>
            ● On the map
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
            <div style={{ fontFamily: "'Spectral', serif", fontSize: 16, fontWeight: 500, color: INK, textTransform: "capitalize", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {active.res.theme}
            </div>
            <span style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>
              {active.res.tracks.length} tracks · {active.res.totalLabel}
            </span>
          </div>
          {active.res.note && (
            <div style={{ fontSize: 11.5, color: MUTED, margin: "2px 0 0", lineHeight: 1.5 }}>
              {active.res.note}
            </div>
          )}

          {/* every action of the active playlist lives HERE, together */}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", flexShrink: 0 }}>
            <button onClick={() => onPlay(active)} title="Show the route on the map and play it" style={btnDark}>
              ▶ Play
            </button>
            <button onClick={onRegenerate} title="Rebuild this playlist with the current weights / variety / mood" style={btnLight}>
              ↻ Regenerate
            </button>
            <button
              onClick={() => setTuneOpen((v) => !v)}
              title="Adjust weights, variety and mood"
              style={{ ...btnLight, background: tuneOpen ? "rgba(43,39,36,0.08)" : "transparent" }}
            >
              ⚖ Tune
            </button>
            <button onClick={() => onExport(active.res)} title="Export the links and create the playlist (Spotlistr / Spotify)" style={btnDark}>
              ↗ Export
            </button>
          </div>

          {notice && <Notice notice={notice} />}

          {tuneOpen && (
            <div style={{ marginTop: 10, maxHeight: "38vh", overflowY: "auto", flexShrink: 0 }}>
              {/* No onRegenerate here: the card's own ↻ button is the one
                  regenerate action. The live-update (legacy) toggle stays. */}
              <WeightControls
                weights={weights} setWeights={setWeights}
                randomness={randomness} setRandomness={setRandomness}
                mood={mood} setMood={setMood}
                liveRegen={liveRegen} setLiveRegen={setLiveRegen}
              />
            </div>
          )}

          <ol ref={listRef} style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", overflowY: "auto", minHeight: 0, maxHeight: "34vh" }}>
            {active.res.tracks.map((t, i) => (
              <li
                key={t.id}
                onClick={() => onPick(t.id)}
                title="Show on the map"
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 6px", borderRadius: 4, cursor: "pointer",
                  fontSize: 12.5,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(43,39,36,0.05)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ width: 16, textAlign: "right", color: MUTED, fontSize: 11 }}>{i + 1}</span>
                <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: genreColor(t.genre) }} />
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: INK }}>
                  {t.title} <span style={{ color: MUTED }}>— {t.artist}</span>
                </span>
                <span style={{ color: MUTED, fontSize: 11, flexShrink: 0 }}>{t.duration}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div style={{ padding: "14px", fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
          Type a genre, mood, artist, or number of tracks — or tap a suggestion.
          You can also click any node on the map and hit <b>♫ Generate</b> in its card.
        </div>
      )}

      {/* ---- zone 3: compact history ---- */}
      {history.length > 0 && (
        <div style={{ borderTop: `1px solid rgba(154,147,138,0.3)`, flexShrink: 0, padding: "8px 14px 10px", maxHeight: "22vh", overflowY: "auto" }}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            style={{
              fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
              color: MUTED, background: "transparent", border: "none", padding: 0, cursor: "pointer",
            }}
          >
            {historyOpen ? "▾" : "▸"} Previous playlists ({history.length})
          </button>
          {historyOpen && history.map((h, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: INK, textTransform: "capitalize" }}>
                {h.res.theme}
              </span>
              <span style={{ color: MUTED, fontSize: 11, flexShrink: 0 }}>{h.res.tracks.length} tracks</span>
              <button onClick={() => onRestore(h)} title="Bring this playlist back on the map" style={iconBtn}>
                ↩ Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ notice }) {
  return (
    <div style={{ margin: "8px 0 0", fontSize: 12, color: notice.error ? "#c75b4a" : MUTED, display: "flex", alignItems: "center", gap: 8, lineHeight: 1.5 }}>
      <span style={{ minWidth: 0 }}>{notice.text}</span>
      {notice.link && (
        <a href={notice.link} target="_blank" rel="noopener noreferrer"
           style={{ color: PAPER, background: INK, padding: "4px 10px", borderRadius: 12, textDecoration: "none", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }}>
          {notice.linkLabel || "Open ↗"}
        </a>
      )}
    </div>
  );
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s;
}

const iconBtn = {
  fontFamily: font, fontSize: 11, color: MUTED,
  background: "transparent", border: `1px solid rgba(154,147,138,0.5)`,
  borderRadius: 4, padding: "3px 8px", cursor: "pointer", flexShrink: 0,
};
const chip = {
  fontFamily: font, fontSize: 11.5, color: INK,
  background: "rgba(43,39,36,0.05)", border: `1px solid rgba(154,147,138,0.4)`,
  borderRadius: 14, padding: "4px 10px", cursor: "pointer",
};
const btnDark = {
  fontFamily: font, fontSize: 11.5, fontWeight: 500,
  color: PAPER, background: INK, border: "none", borderRadius: 14,
  padding: "5px 13px", cursor: "pointer", whiteSpace: "nowrap",
};
const btnLight = {
  fontFamily: font, fontSize: 11.5, fontWeight: 500,
  color: INK, background: "transparent", border: `1px solid ${INK}`,
  borderRadius: 14, padding: "4px 12px", cursor: "pointer", whiteSpace: "nowrap",
};
