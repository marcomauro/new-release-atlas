import React, { useRef, useEffect } from "react";

const INK = "#2b2724";
const PAPER = "#f4f1ea";
const MUTED = "#9a938a";

const SUGGESTIONS = [
  "jazz rilassante, 15 brani",
  "soulful house per la festa",
  "tipo Moodymann",
  "mix neo-soul e uk jazz per la sera",
  "sorprendimi",
];

export default function Chat({
  open, setOpen, messages, value, onChange, onSubmit, onClear, onPick,
  genreColor, hasPlaylist,
}) {
  const bodyRef = useRef(null);
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
          position: "absolute", bottom: 24, left: "50%",
          transform: "translateX(-50%)", zIndex: 30,
          fontFamily: font, fontSize: 13, fontWeight: 500,
          color: PAPER, background: INK, border: "none",
          padding: "10px 18px", borderRadius: 22, cursor: "pointer",
          boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
        }}
      >
        ♫ Crea una playlist
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute", bottom: 20, left: "50%",
        transform: "translateX(-50%)", zIndex: 30,
        width: "min(580px, 94vw)",
        fontFamily: font,
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${MUTED}`, borderRadius: 8,
        boxShadow: "0 12px 40px rgba(0,0,0,0.16)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* header */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", borderBottom: `1px solid rgba(154,147,138,0.3)`,
        }}
      >
        <span style={{ fontFamily: "'Spectral', serif", fontSize: 15, fontWeight: 500, color: INK }}>
          ♫ Playlist dal grafo
        </span>
        <span style={{ fontSize: 11, color: MUTED }}>— descrivi cosa vuoi ascoltare</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {hasPlaylist && (
            <button onClick={onClear} title="Rimuovi evidenziazione" style={iconBtn}>
              pulisci
            </button>
          )}
          <button onClick={() => setOpen(false)} title="Chiudi" style={iconBtn}>
            ✕
          </button>
        </span>
      </div>

      {/* messaggi */}
      <div ref={bodyRef} style={{ maxHeight: "46vh", overflowY: "auto", padding: "12px 14px" }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.6 }}>
            Scrivi per genere, mood, artista o numero di brani. Esempi:
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0" }}>
              <div style={{ background: INK, color: PAPER, padding: "7px 12px", borderRadius: "12px 12px 2px 12px", fontSize: 13, maxWidth: "80%" }}>
                {m.text}
              </div>
            </div>
          ) : (
            <Assistant key={i} res={m.res} onPick={onPick} genreColor={genreColor} />
          )
        )}
      </div>

      {/* suggerimenti (solo all'inizio) */}
      {messages.length === 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 14px 10px" }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => onSubmit(s)} style={chip}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* input */}
      <form onSubmit={submit} style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: `1px solid rgba(154,147,138,0.3)` }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="es: soul-funk groovy, una decina di brani"
          style={{
            flex: 1, fontFamily: font, fontSize: 13, color: INK,
            border: `1px solid ${MUTED}`, borderRadius: 6, padding: "8px 10px",
            background: "rgba(255,255,255,0.7)", outline: "none",
          }}
        />
        <button type="submit" style={{ fontFamily: font, fontSize: 13, fontWeight: 500, color: PAPER, background: INK, border: "none", borderRadius: 6, padding: "0 16px", cursor: "pointer" }}>
          Genera
        </button>
      </form>
    </div>
  );
}

function Assistant({ res, onPick, genreColor }) {
  if (!res || !res.ok) {
    return (
      <div style={{ margin: "8px 0", fontSize: 13, color: "#c75b4a" }}>
        Non sono riuscito a costruire una playlist. Prova a indicare un genere, un mood o un artista.
      </div>
    );
  }
  return (
    <div style={{ margin: "8px 0 14px" }}>
      <div style={{ fontFamily: "'Spectral', serif", fontSize: 15, fontWeight: 500, color: INK, textTransform: "capitalize" }}>
        {res.theme}
      </div>
      <div style={{ fontSize: 11.5, color: MUTED, margin: "2px 0 8px", lineHeight: 1.5 }}>
        {res.note}
      </div>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
        {res.tracks.map((t, i) => (
          <li
            key={t.id}
            onClick={() => onPick(t.id)}
            title="Mostra sul grafo"
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
