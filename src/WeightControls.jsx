import React from "react";
import { DEFAULT_LINK_WEIGHTS, DEFAULT_RANDOMNESS, DEFAULT_MOOD } from "./playlist.js";

const INK = "#2b2724";
const MUTED = "#9a938a";

const MOOD_ROWS = [
  ["energy", "Energy"],
  ["valence", "Valence"],
  ["danceability", "Danceability"],
  ["acousticness", "Acousticness"],
  ["instrumentalness", "Instrumental"],
];

// Slider per i pesi dei legami + varieta' + (opzionale) mood. Condiviso tra il
// pannello del brano e la chat. Gerarchia default: artista > genere primario >
// genere secondario > stessa playlist (= graph.json meta.linkWeights).
export default function WeightControls({ weights, setWeights, randomness, setRandomness, mood, setMood }) {
  const rows = [
    ["primary", "Primary genre"],
    ["artist", "Artist"],
    ["secondary", "Secondary genre"],
    ["playlist", "Same playlist"],
  ];
  const set = (k, v) => setWeights((w) => ({ ...w, [k]: v }));
  const setInfluence = (v) => setMood((m) => ({ ...m, influence: v }));
  const setTarget = (k, v) => setMood((m) => ({ ...m, target: { ...m.target, [k]: v } }));
  const reset = () => {
    setWeights({ ...DEFAULT_LINK_WEIGHTS });
    if (setRandomness) setRandomness(DEFAULT_RANDOMNESS);
    if (setMood) setMood({ influence: DEFAULT_MOOD.influence, target: { ...DEFAULT_MOOD.target } });
  };
  return (
    <div style={{ padding: "10px 12px", background: "rgba(43,39,36,0.04)", borderRadius: 4 }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED,
        marginBottom: 8, display: "flex", justifyContent: "space-between",
      }}>
        <span>Route weights</span>
        <span onClick={reset} style={{ cursor: "pointer", textDecoration: "underline" }}>reset</span>
      </div>
      {rows.map(([k, label]) => (
        <Row key={k} label={label} value={weights[k] ?? 0} min={0} max={5} step={0.1}
             onChange={(v) => set(k, v)} />
      ))}
      {setRandomness && (
        <Row label="Variety (random)" value={randomness ?? 0} min={0} max={1} step={0.05}
             onChange={setRandomness} decimals={2} />
      )}

      {mood && setMood && (
        <div style={{ marginTop: 10, borderTop: `1px solid rgba(154,147,138,0.25)`, paddingTop: 8 }}>
          <div style={{
            fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED, marginBottom: 6,
          }}>
            Mood
          </div>
          <Row label="Mood influence" value={mood.influence ?? 0} min={0} max={1} step={0.05}
               onChange={setInfluence} decimals={2} />
          <div style={{ opacity: mood.influence > 0 ? 1 : 0.4, transition: "opacity .15s" }}>
            {MOOD_ROWS.map(([k, label]) => (
              <Row key={k} label={label} value={mood.target?.[k] ?? 0.5} min={0} max={1} step={0.05}
                   onChange={(v) => setTarget(k, v)} decimals={2} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, min, max, step, onChange, decimals = 1 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "5px 0" }}>
      <span style={{ fontSize: 11, width: 118, color: INK }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} style={{ flex: 1 }}
      />
      <span style={{ fontSize: 11, width: 28, textAlign: "right", color: MUTED }}>
        {Number(value).toFixed(decimals)}
      </span>
    </div>
  );
}
