import React from "react";
import { DEFAULT_LINK_WEIGHTS, DEFAULT_RANDOMNESS } from "./playlist.js";

const INK = "#2b2724";
const MUTED = "#9a938a";

// Slider per i pesi dei legami + fattore di varieta'. Condiviso tra il pannello
// del brano e la chat. Gerarchia default: genere primario > artista >
// genere secondario > stessa playlist.
export default function WeightControls({ weights, setWeights, randomness, setRandomness }) {
  const rows = [
    ["primary", "Genere primario"],
    ["artist", "Artista"],
    ["secondary", "Genere secondario"],
    ["playlist", "Stessa playlist"],
  ];
  const set = (k, v) => setWeights((w) => ({ ...w, [k]: v }));
  const reset = () => {
    setWeights({ ...DEFAULT_LINK_WEIGHTS });
    if (setRandomness) setRandomness(DEFAULT_RANDOMNESS);
  };
  return (
    <div style={{ padding: "10px 12px", background: "rgba(43,39,36,0.04)", borderRadius: 4 }}>
      <div style={{
        fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED,
        marginBottom: 8, display: "flex", justifyContent: "space-between",
      }}>
        <span>Pesi del percorso</span>
        <span onClick={reset} style={{ cursor: "pointer", textDecoration: "underline" }}>ripristina</span>
      </div>
      {rows.map(([k, label]) => (
        <Row key={k} label={label} value={weights[k] ?? 0} min={0} max={5} step={0.1}
             onChange={(v) => set(k, v)} />
      ))}
      {setRandomness && (
        <Row label="Varietà (random)" value={randomness ?? 0} min={0} max={1} step={0.05}
             onChange={setRandomness} decimals={2} />
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
