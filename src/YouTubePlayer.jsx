import React, { useEffect, useRef, useState, useCallback } from "react";
import { MUTED } from "./theme.js";
import { Shell, Marquee, ProgressRow, TransportRow, SourceSwitch, navBtn } from "./playerChrome.jsx";
import { step, firstPlayable, afterEnd, shuffledOrder } from "./playbackRoute.js";

// Carica una sola volta l'IFrame Player API di YouTube.
let _yt = null;
let _ytPromise = null;
function loadYouTubeApi() {
  if (_yt) return Promise.resolve(_yt);
  if (window.YT && window.YT.Player) {
    _yt = window.YT;
    return Promise.resolve(_yt);
  }
  if (_ytPromise) return _ytPromise;
  _ytPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === "function") prev();
      _yt = window.YT;
      resolve(_yt);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { _ytPromise = null; reject(new Error("YouTube API failed to load")); };
    document.body.appendChild(s);
  });
  return _ytPromise;
}

export function preloadYouTubeApi() {
  if (typeof window !== "undefined") loadYouTubeApi().catch(() => {});
}

// YT.PlayerState values used here.
const ENDED = 0;
const PLAYING = 1;
const PAUSED = 2;

// onError codes → why the track was skipped (one short clause).
function describeYtError(code) {
  if (code === 101 || code === 150) return "its owner doesn't allow playback outside YouTube";
  if (code === 100) return "the video is no longer available";
  if (code === 153) return "YouTube refused the embed";
  return "YouTube couldn't play it";
}

/* Mini-player YOUTUBE: brani interi per tutti, senza account.
   A differenza del Connect, la CODA la tiene l'app: il player YouTube
   riproduce un video alla volta (videoId risolto offline in graph.json,
   campo `yt`), a fine brano si avanza con playbackRoute.js. I brani senza
   video, o che YouTube rifiuta (embed disabilitato…), vengono saltati.

   Regole YouTube rispettate: player sempre visibile e ≥200×200, nessun
   overlay sul video, niente audio separato dal video. Dominio
   youtube-nocookie.com: nessun cookie finché non si preme play. */
export default function YouTubePlayer({ tracks, index, setIndex, onClose, bottomGap, isMobile, onOpenTrack, onHeight, sources, onSource }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);                    // YT.Player instance
  const loadedRef = useRef({ tracks: null, i: -1 }); // what the player holds now
  const failedRef = useRef(new Set());               // ids YouTube refused this session
  const hintTimer = useRef(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [prog, setProg] = useState({ pos: 0, dur: 0 });
  const [msg, setMsg] = useState("");
  const [hint, setHint] = useState(false);           // autoplay blocked → "press ▶"
  const [shuffle, setShuffle] = useState(false);
  const [order, setOrder] = useState(null);
  const [repeat, setRepeat] = useState("off");       // off | all | one

  // Latest values for the player's event callbacks, which are bound once.
  const live = useRef({});
  live.current = { tracks, index, setIndex, repeat, order };

  const playable = useCallback((i) => {
    const t = live.current.tracks[i];
    return !!(t && t.yt && !failedRef.current.has(t.id));
  }, []);

  // Move to index `n` (or stop when n < 0). Same index = replay from 0.
  const goTo = useCallback((n, note = "") => {
    const L = live.current;
    setMsg(note);
    if (n < 0) {
      setPaused(true);
      if (!note) setMsg("End of the route.");
      return;
    }
    if (n === L.index && loadedRef.current.i === n && playerRef.current) {
      playerRef.current.seekTo(0, true);
      playerRef.current.playVideo();
      return;
    }
    L.setIndex(n);
  }, []);

  // Create the player once (the API script is preloaded at app start).
  // YT replaces the element it is given with its iframe, so it gets a
  // child div React does not own.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      const el = document.createElement("div");
      hostRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        host: "https://www.youtube-nocookie.com",
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, autoplay: 1, origin: window.location.origin },
        events: {
          onReady: () => { if (!cancelled) setReady(true); },
          onStateChange: (e) => {
            if (e.data === PLAYING) {
              setPaused(false);
              setHint(false);
              clearTimeout(hintTimer.current);
            } else if (e.data === PAUSED) {
              setPaused(true);
            } else if (e.data === ENDED) {
              const L = live.current;
              goTo(afterEnd({ index: L.index, count: L.tracks.length, repeat: L.repeat, order: L.order, playable }));
            }
          },
          onError: (e) => {
            const L = live.current;
            const t = L.tracks[L.index];
            if (t) failedRef.current.add(t.id);
            const n = step({ index: L.index, count: L.tracks.length, repeat: L.repeat, order: L.order, playable });
            goTo(n, t ? `“${t.title}” skipped — ${describeYtError(e.data)}.` : "");
          },
        },
      });
    }).catch(() => {
      if (!cancelled) setMsg("YouTube couldn't be loaded — check the connection, or switch source.");
    });
    return () => {
      cancelled = true;
      clearTimeout(hintTimer.current);
      try { playerRef.current && playerRef.current.destroy(); } catch (e) { /* noop */ }
      playerRef.current = null;
    };
  }, [goTo, playable]);

  // A NEW route (generate / regenerate / restore) starts from its first
  // track; the first load after mount keeps the current index, so switching
  // source mid-route resumes where the route was.
  useEffect(() => {
    if (!ready) return;
    const L = loadedRef.current;
    const fresh = L.tracks !== null && L.tracks !== tracks;
    if (fresh && shuffle) setOrder(shuffledOrder(tracks.length, 0));
    const start = fresh ? 0 : index;
    const want = firstPlayable({ index: start, count: tracks.length, order: fresh ? null : order, playable });
    if (want < 0) {
      loadedRef.current = { tracks, i: -1 };
      try { playerRef.current.stopVideo(); } catch (e) { /* noop */ }
      setPaused(true);
      setMsg(tracks.some((t) => t.yt)
        ? "No more tracks of this route can play on YouTube."
        : "None of these tracks has been matched on YouTube yet.");
      return;
    }
    if (want !== start) setIndex(want); // highlight the track actually playing
    if (!fresh && L.i === want) return;
    loadedRef.current = { tracks, i: want };
    setProg({ pos: 0, dur: 0 });
    playerRef.current.loadVideoById(tracks[want].yt);
    // Mobile browsers may block autoplay outside a tap: if nothing plays
    // shortly, say what to do instead of looking stuck.
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      const p = playerRef.current;
      if (p && p.getPlayerState && p.getPlayerState() !== PLAYING) setHint(true);
    }, 4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tracks, index]);

  // Progress: read from the player twice a second, only while visible.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (document.hidden || !p || !p.getCurrentTime) return;
      setProg({ pos: (p.getCurrentTime() || 0) * 1000, dur: (p.getDuration() || 0) * 1000 });
    }, 500);
    return () => clearInterval(id);
  }, [ready]);

  const shown = Math.min(Math.max(index, 0), tracks.length - 1);
  const cur = tracks[shown];
  const onYouTube = tracks.filter((t) => t.yt).length;
  const many = onYouTube > 1;
  if (!cur) return null;

  const p = () => (ready ? playerRef.current : null);
  const toggle = () => {
    const pl = p();
    if (!pl) return;
    setHint(false);
    if (paused) pl.playVideo(); else pl.pauseVideo();
  };
  const goPrev = () => {
    const pl = p();
    if (pl && prog.pos > 3000) { pl.seekTo(0, true); return; }
    const n = step({ index: shown, count: tracks.length, dir: -1, repeat, order, playable });
    if (n >= 0) goTo(n); else if (pl) pl.seekTo(0, true);
  };
  const goNext = () => {
    const n = step({ index: shown, count: tracks.length, dir: 1, repeat, order, playable });
    if (n >= 0) goTo(n);
  };
  const onSeek = (ms) => {
    const pl = p();
    if (!pl) return;
    setProg((x) => ({ ...x, pos: ms }));
    pl.seekTo(ms / 1000, true);
  };
  const toggleShuffle = () => {
    const next = !shuffle;
    setShuffle(next);
    setOrder(next ? shuffledOrder(tracks.length, shown) : null);
  };
  const cycleRepeat = () => setRepeat((r) => ({ off: "all", all: "one", one: "off" })[r]);

  return (
    <Shell bottomGap={bottomGap} onHeight={onHeight}>
      {/* The video box keeps the same position in the tree on every layout:
          the YouTube iframe lives inside it and must never be remounted. */}
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "stretch", gap: 12, padding: "10px 12px 8px" }}>
        <div
          ref={hostRef}
          style={{ width: isMobile ? "100%" : 200, height: 200, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "#000" }}
        />

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4 }}>
          {/* row 1: title (marquee when it overflows) + close */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                onClick={() => onOpenTrack && onOpenTrack(cur.id)}
                title="Show on the map"
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: onOpenTrack ? "pointer" : "default" }}
              >
                <Marquee text={`${cur.title} — ${cur.artist}`} />
              </button>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>
                <SourceSwitch active="youtube" sources={sources} onSource={onSource} />
                {tracks.length > 1 ? ` · ${shown + 1}/${tracks.length}` : ""}
                {onYouTube < tracks.length ? ` · ${onYouTube} on YouTube` : ""}
              </div>
            </div>
            <button onClick={onClose} title="Close" aria-label="Close" style={navBtn}>✕</button>
          </div>

          {/* row 2: progress + seek */}
          <ProgressRow pos={prog.pos} dur={prog.dur} onSeek={onSeek} />

          {/* row 3: transport */}
          <TransportRow
            shuffle={shuffle} onShuffle={toggleShuffle} many={many} onPrev={goPrev} onNext={goNext}
            paused={paused} onToggle={toggle} repeat={repeat} onRepeat={cycleRepeat}
          />
        </div>
      </div>

      {(msg || hint) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 10px", fontSize: 11, color: "#9a5b3a" }}>
          <span style={{ flex: 1, wordBreak: "break-word" }}>
            {hint ? "Press ▶ (or tap the video) to start playback." : msg}
          </span>
          {!hint && onYouTube === 0 && onSource && sources.includes("spotify") && (
            <button onClick={() => onSource("spotify")} title="Listen on Spotify" style={{ ...navBtn, fontSize: 11 }}>
              Use Spotify
            </button>
          )}
        </div>
      )}
    </Shell>
  );
}
