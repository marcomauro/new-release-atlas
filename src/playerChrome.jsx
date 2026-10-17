import React, { useEffect, useRef, useState } from "react";
import { INK, PAPER, MUTED } from "./theme.js";

// Pieces shared by every mini-player engine (Spotify Connect / embed,
// YouTube): the floating shell, the scrolling title, the progress row, the
// transport row, the listening-source switch and the button styles.

// Listening sources the switch can offer, with their brand dot colour.
export const SOURCE_LABEL = { youtube: "YouTube", spotify: "Spotify" };
export const SOURCE_COLOR = { youtube: "#ff0033", spotify: "#1db954" };

// "● YouTube · Spotify": the active source is the filled label, the others
// are buttons that switch the engine (the route and its position are kept).
// With a single available source it is just the coloured label.
export function SourceSwitch({ active, sources = [active], onSource }) {
  const others = sources.filter((s) => s !== active);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: SOURCE_COLOR[active], fontWeight: 600 }}>● {SOURCE_LABEL[active]}</span>
      {onSource && others.map((s) => (
        <button
          key={s}
          onClick={() => onSource(s)}
          title={`Listen on ${SOURCE_LABEL[s]}`}
          style={{
            fontFamily: "Inter, sans-serif", fontSize: 10.5, lineHeight: 1, color: MUTED,
            background: "transparent", border: "1px solid rgba(154,147,138,0.5)",
            borderRadius: 8, padding: "2px 6px", cursor: "pointer",
          }}
        >
          {SOURCE_LABEL[s]}
        </button>
      ))}
    </span>
  );
}

// Elapsed · seekable bar · total (6px bar, ~20px pointer target).
// `onSeek(ms)` receives the target position in milliseconds.
export function ProgressRow({ pos, dur, onSeek }) {
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const seek = (e) => {
    if (!dur || !onSeek) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onSeek(frac * dur);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: MUTED, width: 30, textAlign: "right" }}>{fmtTime(pos)}</span>
      <div onClick={seek} style={{ flex: 1, padding: "7px 0", cursor: "pointer" }}>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(154,147,138,0.3)", position: "relative" }}>
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: INK, borderRadius: 3 }} />
        </div>
      </div>
      <span style={{ fontSize: 10, color: MUTED, width: 30 }}>{fmtTime(dur)}</span>
    </div>
  );
}

// Shuffle · previous · play/pause · next · repeat, spread along the width.
export function TransportRow({ shuffle, onShuffle, many, onPrev, onNext, paused, onToggle, repeat, onRepeat }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
      <button onClick={onShuffle} title="Shuffle the route" aria-label="Shuffle" style={tglBtn(shuffle)}>⇄</button>
      <button onClick={onPrev} disabled={!many} title="Previous" aria-label="Previous track" style={{ ...navBtn, opacity: many ? 1 : 0.35 }}>‹</button>
      <button onClick={onToggle} title={paused ? "Resume" : "Pause"} aria-label={paused ? "Resume" : "Pause"} style={playBtn}>{paused ? "▶" : "❚❚"}</button>
      <button onClick={onNext} disabled={!many} title="Next" aria-label="Next track" style={{ ...navBtn, opacity: many ? 1 : 0.35 }}>›</button>
      <button onClick={onRepeat} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`} style={tglBtn(repeat !== "off")}>{repeat === "one" ? "₁⟲" : "⟲"}</button>
    </div>
  );
}

// Single-line title that scrolls (seamless loop) only when it doesn't fit:
// the text is duplicated and translated by -50%, so the loop point is
// invisible; a hold at the start keeps the beginning readable. Recomputed
// on every track change.
export function Marquee({ text }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [scroll, setScroll] = useState(false);
  useEffect(() => {
    const o = outerRef.current;
    const i = innerRef.current;
    if (o && i) setScroll(i.scrollWidth > o.clientWidth + 2);
  }, [text]);
  const dur = Math.max(9, text.length * 0.32); // longer titles scroll slower
  const [title, artist] = splitDash(text);
  const content = (
    <>
      <span style={{ color: INK }}>{title}</span>
      {artist && <span style={{ color: MUTED }}> — {artist}</span>}
    </>
  );
  return (
    <div ref={outerRef} style={{ overflow: "hidden", whiteSpace: "nowrap", fontSize: 12.5, lineHeight: 1.25 }}>
      <div
        ref={innerRef}
        className={scroll ? "mn-marquee" : undefined}
        style={{ display: "inline-block", ...(scroll ? { animationDuration: `${dur}s` } : {}) }}
      >
        {content}
        {scroll && <span style={{ padding: "0 28px" }} aria-hidden="true">{content}</span>}
      </div>
    </div>
  );
}

function splitDash(s) {
  const i = s.lastIndexOf(" — ");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 3)];
}

export function Shell({ children, bottomGap, onHeight }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !onHeight) return;
    const report = () => onHeight(ref.current ? ref.current.offsetHeight : 0);
    const ro = new ResizeObserver(report);
    ro.observe(ref.current);
    report();
    return () => { ro.disconnect(); onHeight(0); };
  }, [onHeight]);
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: `calc(${bottomGap}px + env(safe-area-inset-bottom))`,
        zIndex: 45,
        width: "min(580px, 94vw)",
        background: "rgba(255,255,255,0.97)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${MUTED}`,
        borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <style>{`
        /* Marquee for overflowing titles: duplicated content + -50% loop =
           seamless; the 12% hold keeps the start readable before scrolling. */
        .mn-marquee { animation: mn-marquee 12s linear infinite; will-change: transform; }
        @keyframes mn-marquee {
          0%, 12% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
      {children}
    </div>
  );
}

export function fmtTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const navBtn = {
  fontFamily: "Inter, sans-serif",
  fontSize: 14,
  lineHeight: 1,
  color: INK,
  background: "transparent",
  border: `1px solid rgba(154,147,138,0.5)`,
  borderRadius: 6,
  padding: "5px 9px",
  cursor: "pointer",
};
// "toggle" button: active = filled (ink), off = outline
export const tglBtn = (active) => ({
  ...navBtn,
  color: active ? PAPER : INK,
  background: active ? INK : "transparent",
  borderColor: active ? INK : "rgba(154,147,138,0.5)",
});
// play/pause: the transport's round centrepiece, bigger than the rest
export const playBtn = {
  ...navBtn,
  width: 40,
  height: 40,
  padding: 0,
  borderRadius: "50%",
  fontSize: 15,
  color: PAPER,
  background: INK,
  borderColor: INK,
};
