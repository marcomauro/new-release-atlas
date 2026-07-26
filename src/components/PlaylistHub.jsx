import React, { useEffect, useRef, useState } from "react";
import WeightControls from "../WeightControls.jsx";
import { INK, PAPER, MUTED } from "../theme.js";
import { truncateGraphemes } from "../text.js";

const font = "Inter, system-ui, sans-serif";

// Playlist Hub — the panel behind the "Playlist" launcher. Minimalist rule:
// show the ask OR the result, never both. With no active playlist the panel
// is just a prompt row; once one exists, the ACTIVE card is the whole panel
// (title, actions, tracklist) and the prompt collapses behind a small "+ New"
// in the header, reappearing only on demand and folding back after each
// generation. Previous generations sit in a compact restorable history.
export default function PlaylistHub({
  open, setOpen, value, onChange, onSubmit,
  active, history, notice,
  onPick, onPlay, onExport, onRegenerate, onRestore,
  genreColor, bottomOffset = 0,
  weights, setWeights, randomness, setRandomness, mood, setMood,
  liveRegen, setLiveRegen,
}) {
  const [tuneOpen, setTuneOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const inputRef = useRef(null);

  // A new/updated generation takes the stage: fold the prompt away.
  useEffect(() => { setPromptOpen(false); }, [active]);
  // Focus the input whenever the prompt row (re)appears.
  const showPrompt = !active || promptOpen;
  useEffect(() => {
    if (open && showPrompt) inputRef.current?.focus();
  }, [open, showPrompt]);

  const submit = (e) => {
    e.preventDefault();
    const t = (value || "").trim();
    if (t) onSubmit(t);
  };

  if (!open) {
    const label = active ? `♫ ${truncateGraphemes(active.res.theme, 26)}` : "Playlist";
    return (
      <button
        onClick={() => setOpen(true)}
        title={active ? "Reopen the playlist panel" : "Build a playlist from the graph"}
        style={{
          // The map's one PRIMARY action: dark pill with a touch of
          // transparency — deliberately different from the outlined utility
          // buttons (Genres/Reset) so it stands out.
          position: "absolute", bottom: `calc(${24 + bottomOffset}px + env(safe-area-inset-bottom))`, left: "50%",
          transform: "translateX(-50%)", zIndex: 30,
          fontFamily: font, fontSize: 14, fontWeight: 500,
          color: PAPER, background: "rgba(43,39,36,0.88)",
          backdropFilter: "blur(6px)",
          border: "none",
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
        // viewport. The card body is the single scroll area and compresses.
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
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {active && (
            <button
              onClick={() => setPromptOpen((v) => !v)}
              title="Ask for a new playlist"
              style={{ ...iconBtn, background: promptOpen ? "rgba(43,39,36,0.08)" : "transparent" }}
            >
              + New
            </button>
          )}
          <button onClick={() => setOpen(false)} title="Close" style={iconBtn}>
            ✕
          </button>
        </span>
      </div>

      {/* ---- prompt row: visible only when asking ---- */}
      {showPrompt && (
        <div style={{ padding: "10px 14px", flexShrink: 0, borderBottom: `1px solid rgba(154,147,138,0.3)` }}>
          <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="genre, mood, artist… e.g. groovy soul-funk, 10 tracks"
              style={{
                flex: 1, minWidth: 0, fontFamily: font, fontSize: 13, color: INK,
                border: `1px solid ${MUTED}`, borderRadius: 14, padding: "8px 12px",
                background: "rgba(255,255,255,0.7)", outline: "none",
              }}
            />
            <button type="submit" style={{ ...btnDark, fontSize: 12.5, padding: "7px 16px" }}>
              Generate
            </button>
          </form>
          {!active && (
            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
              Tip: you can also click any node on the map and hit <b>♫ Generate</b>.
            </div>
          )}
          {notice && !active && <Notice notice={notice} />}
        </div>
      )}

      {/* ---- ACTIVE playlist card: the panel's main citizen ---- */}
      {active && (
        <div style={{ padding: "10px 14px", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase", color: MUTED, flexShrink: 0 }}>
              ● On the map
            </span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED, flexShrink: 0 }}>
              {active.res.tracks.length} tracks · {active.res.totalLabel}
            </span>
          </div>
          <div style={{ fontFamily: "'Spectral', serif", fontSize: 16, fontWeight: 500, color: INK, textTransform: "capitalize", marginTop: 2, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 }}>
            {active.res.theme}
          </div>

          {/* every action of the active playlist lives here, together */}
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

          {/* single scroll context: sliders and tracklist share it, so the
              tune panel can always be scrolled to its last slider */}
          <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", marginTop: 8 }}>
            {tuneOpen && (
              <div style={{ marginBottom: 8 }}>
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
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
              {active.res.tracks.map((t, i) => (
                <li
                  key={t.id}
                  onClick={() => onPick(t.id)}
                  title="Show on the map"
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 6px", borderRadius: 4, cursor: "pointer",
                    // lineHeight + overflow keep a Zalgo-style title (hundreds
                    // of stacked combining marks) from blowing up the row.
                    fontSize: 12.5, lineHeight: 1.25, overflow: "hidden",
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
        </div>
      )}

      {/* ---- compact history ---- */}
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



const iconBtn = {
  fontFamily: font, fontSize: 11, color: MUTED,
  background: "transparent", border: `1px solid rgba(154,147,138,0.5)`,
  borderRadius: 4, padding: "3px 8px", cursor: "pointer", flexShrink: 0,
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
