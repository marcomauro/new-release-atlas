import React, { useRef, useEffect, useState } from "react";
import WeightControls from "./WeightControls.jsx";

const INK = "#2b2724";
const PAPER = "#f4f1ea";
const MUTED = "#9a938a";

const SUGGESTIONS = [
  "relaxing jazz, 15 tracks",
  "soulful house for the party",
  "like Moodymann",
  "mix neo-soul and uk jazz for the evening",
  "surprise me",
];

export default function Chat({
  open, setOpen, messages, value, onChange, onSubmit, onPick, onPlay,
  onExport, genreColor, bottomOffset = 0,
  weights, setWeights, randomness, setRandomness, mood, setMood,
  liveRegen, setLiveRegen, onRegenerate, canRegenerate,
}) {
  const bodyRef = useRef(null);
  const [showWeights, setShowWeights] = useState(false);
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, open]);

  const submit = (e) => {
    e.preventDefault();
    const t = (value || "").trim();
    if (t) onSubmit(t);
  };

  const font = "Inter, system-ui, sans-serif";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "absolute", bottom: `calc(${24 + bottomOffset}px + env(safe-area-inset-bottom))`, left: "50%",
          transform: "translateX(-50%)", zIndex: 30,
          fontFamily: font, fontSize: 14, fontWeight: 500,
          color: PAPER, background: INK, border: "none",
          padding: "11px 23px", borderRadius: 23, cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
        }}
      >
        Playlist
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
        // Tetto d'altezza: il pannello (ancorato in basso) non deve mai superare
        // il viewport, altrimenti l'header con ✕/⚖ esce sopra lo schermo e su
        // mobile non si riesce più a chiudere i pesi. La lista messaggi si comprime.
        maxHeight: `calc(100dvh - ${32 + bottomOffset}px - env(safe-area-inset-bottom))`,
        fontFamily: font,
        background: "rgba(255,255,255,0.72)",
        backdropFilter: "blur(10px)",
        border: `1px solid ${MUTED}`, borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0,0,0,0.16)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* header */}
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
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {setWeights && (
            <button onClick={() => setShowWeights((v) => !v)} title="Adjust route weights"
              style={{ ...iconBtn, background: showWeights ? "rgba(43,39,36,0.08)" : "transparent" }}>
              ⚖ weights
            </button>
          )}
          <button onClick={() => setOpen(false)} title="Close" style={iconBtn}>
            ✕
          </button>
        </span>
      </div>

      {showWeights && setWeights && (
        <div style={{ padding: "10px 14px", borderBottom: `1px solid rgba(154,147,138,0.3)`, flexShrink: 0, maxHeight: "50vh", overflowY: "auto" }}>
          <WeightControls
            weights={weights} setWeights={setWeights}
            randomness={randomness} setRandomness={setRandomness}
            mood={mood} setMood={setMood}
            liveRegen={liveRegen} setLiveRegen={setLiveRegen}
            onRegenerate={onRegenerate} canRegenerate={canRegenerate}
          />
        </div>
      )}

      {/* messaggi */}
      <div ref={bodyRef} style={{ flex: "1 1 auto", minHeight: 0, maxHeight: "46vh", overflowY: "auto", padding: "12px 14px" }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
            Type a genre, mood, artist, or number of tracks. Examples:
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
              <div style={{ background: INK, color: PAPER, padding: "7px 12px", borderRadius: "12px 12px 2px 12px", fontSize: 13, maxWidth: "80%" }}>
                {m.text}
              </div>
            </div>
          ) : m.role === "system" ? (
            <div key={i} style={{ margin: "8px 0", fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 8 }}>
              <span>{m.text}</span>
              {m.link && (
                <a href={m.link} target="_blank" rel="noopener noreferrer"
                   style={{ color: PAPER, background: INK, padding: "4px 10px", borderRadius: 12, textDecoration: "none", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap" }}>
                  {m.linkLabel || "Open ↗"}
                </a>
              )}
            </div>
          ) : (
            <Assistant key={i} res={m.res} onPick={onPick} onExport={onExport} onPlay={onPlay} genreColor={genreColor} />
          )
        )}
      </div>

      {/* suggerimenti (solo all'inizio) */}
      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 10px", flexShrink: 0 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => onSubmit(s)} style={chip}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* input */}
      <form onSubmit={submit} style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: `1px solid rgba(154,147,138,0.3)`, flexShrink: 0 }}>
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
    </div>
  );
}

function Assistant({ res, onPick, onExport, onPlay, genreColor }) {
  if (!res || !res.ok) {
    return (
      <div style={{ margin: "8px 0", fontSize: 13, color: "#c75b4a" }}>
        I couldn't build a playlist. Try specifying a genre, a mood, or an artist.
      </div>
    );
  }
  return (
    <div style={{ margin: "8px 0 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontFamily: "'Spectral', serif", fontSize: 15, fontWeight: 500, color: INK, textTransform: "capitalize" }}>
          {res.theme}
        </div>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexShrink: 0 }}>
          {onPlay && (
            <button
              onClick={() => onPlay(res.ids)}
              title="Show this playlist on the map and play it"
              style={{
                fontFamily: "Inter, sans-serif", fontSize: 11.5, fontWeight: 500,
                color: INK, background: "transparent", border: `1px solid ${INK}`,
                borderRadius: 14, padding: "4px 12px", cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              ▶ Play
            </button>
          )}
          {onExport && (
            <button
              onClick={() => onExport(res)}
              title="Export the links and create the playlist (Spotlistr / Spotify)"
              style={{
                fontFamily: "Inter, sans-serif", fontSize: 11.5, fontWeight: 500,
                color: PAPER, background: INK, border: "none", borderRadius: 14,
                padding: "4px 12px", cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              ↗ Export
            </button>
          )}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, margin: "2px 0 8px", lineHeight: 1.5 }}>
        {res.note}
      </div>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
        {res.tracks.map((t, i) => (
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
  );
}

const iconBtn = {
  fontFamily: "Inter, sans-serif", fontSize: 11, color: MUTED,
  background: "transparent", border: `1px solid rgba(154,147,138,0.5)`,
  borderRadius: 4, padding: "3px 8px", cursor: "pointer",
};
const chip = {
  fontFamily: "Inter, sans-serif", fontSize: 11.5, color: INK,
  background: "rgba(43,39,36,0.05)", border: `1px solid rgba(154,147,138,0.4)`,
  borderRadius: 14, padding: "5px 11px", cursor: "pointer",
};
