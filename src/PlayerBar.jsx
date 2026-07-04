import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  spotifyPlay, spotifyPause, spotifyResume, spotifyDevices, spotifyState, spotifyTransfer,
  spotifyNext, spotifyPrevious, spotifySeek, spotifyShuffle, spotifyRepeat,
} from "./spotifyConnect.js";
import { INK, PAPER, MUTED } from "./theme.js";

const GREEN = "#1db954";

// Carica una sola volta l'API iFrame ufficiale di Spotify (per l'embed 30s).
let _api = null;
let _apiPromise = null;
function loadSpotifyApi() {
  if (_api) return Promise.resolve(_api);
  if (_apiPromise) return _apiPromise;
  _apiPromise = new Promise((resolve) => {
    window.onSpotifyIframeApiReady = (API) => {
      _api = API;
      resolve(API);
    };
    const s = document.createElement("script");
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.async = true;
    document.body.appendChild(s);
  });
  return _apiPromise;
}

export function preloadSpotifyApi() {
  if (typeof window !== "undefined") loadSpotifyApi();
}

/* Mini-player persistente del PERCORSO.
   - Modalità CONNECT (utente loggato a Spotify Premium): pilota il device
     dell'utente via Web API → brani INTERI in sequenza (anche su mobile).
   - Modalità EMBED (non loggato): l'embed ufficiale, anteprima ~30s, con
     pulsante opt-in "Ascolta intero" per attivare il Connect. */
export default function PlayerBar({ tracks, index, setIndex, onClose, bottomGap = 0, connected, onLogin, isMobile, onOpenTrack, onHeight }) {
  if (connected) {
    return (
      <ConnectPlayer
        tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap}
        isMobile={isMobile} onOpenTrack={onOpenTrack} onHeight={onHeight} onLogin={onLogin}
      />
    );
  }
  return (
    <EmbedPlayer
      tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap} onLogin={onLogin} onHeight={onHeight}
    />
  );
}

// ---------------------------------------------------------------------------
//  CONNECT: full track sul device dell'utente (Premium)
// ---------------------------------------------------------------------------
function ConnectPlayer({ tracks, index, setIndex, onClose, bottomGap, isMobile, onOpenTrack, onHeight, onLogin }) {
  const uris = useMemo(() => tracks.map((t) => `spotify:track:${t.id}`), [tracks]);
  const [paused, setPaused] = useState(false);
  const [liveIdx, setLiveIdx] = useState(index);
  const [msg, setMsg] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [devicesOpen, setDevicesOpen] = useState(false); // device row hidden until asked
  const [authErr, setAuthErr] = useState(false); // token died mid-session -> reconnect CTA
  const [cover, setCover] = useState(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off"); // off | all | one
  const [prog, setProg] = useState({ pos: 0, dur: 0, at: 0, playing: false });
  const [, force] = useState(0);
  const pickedRef = useRef(false);       // did the user pick a device manually?
  const auth401Ref = useRef(0);          // consecutive 401s from the state poll

  const refreshDevices = useCallback(async () => {
    try { const ds = await spotifyDevices(); setDevices(ds); return ds; }
    catch (e) { return []; }
  }, []);

  // Scelta iniziale del device: su mobile preferisci lo Smartphone.
  useEffect(() => {
    (async () => {
      const ds = await refreshDevices();
      if (!ds.length || pickedRef.current) return;
      const phone = ds.find((d) => d.type === "Smartphone");
      const active = ds.find((d) => d.is_active);
      const chosen = (isMobile && phone) || active || ds[0];
      setDeviceId(chosen.id);
    })();
  }, [refreshDevices, isMobile]);

  const playFrom = useCallback(
    async (pos) => {
      setMsg("");
      try {
        await spotifyPlay(uris, pos, deviceId || undefined);
        setPaused(false);
      } catch (e) {
        if (e.status === 404 || e.reason === "NO_ACTIVE_DEVICE") {
          const ds = await refreshDevices();
          const target =
            ds.find((d) => d.id === deviceId) ||
            (isMobile && ds.find((d) => d.type === "Smartphone")) || ds[0];
          if (target) {
            try { await spotifyPlay(uris, pos, target.id); setDeviceId(target.id); setPaused(false); return; }
            catch (e2) { /* fallthrough */ }
          }
          setMsg("Open Spotify on the device and play a track for a moment, then press ⟳.");
          setDevicesOpen(true); // surface the device picker: that's what needs fixing
        } else if (e.status === 403) {
          setMsg("Full playback requires Spotify Premium.");
        } else if (e.status === 401) {
          setMsg("Spotify session expired — reconnect.");
        } else {
          setMsg("Couldn't start playback on Spotify.");
        }
      }
    },
    [uris, deviceId, isMobile, refreshDevices]
  );

  // Ogni attivazione di playlist (generazione / ▶ Play / switch / regen) crea un
  // NUOVO array di tracce → nuovo `uris`. Quando `uris` cambia, parti SEMPRE dal
  // brano 0 (riproduzione immediata del primo brano, anche ri-premendo Play).
  useEffect(() => {
    setLiveIdx(0);
    setProg({ pos: 0, dur: 0, at: Date.now(), playing: true });
    playFrom(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uris]);

  // Poll stato completo: indice live, play/pausa, device, cover, progress,
  // shuffle/repeat. Propaga l'indice reale al genitore (evidenziazione sulla
  // mappa) senza far ripartire la riproduzione.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const c = await spotifyState();
        if (stop || !c) return;
        auth401Ref.current = 0;
        setAuthErr(false);
        if (c.item) {
          const i = uris.indexOf(c.item.uri);
          if (i >= 0) { setLiveIdx(i); setIndex(i); } // follow real progress (display + map)
          const imgs = (c.item.album && c.item.album.images) || [];
          // Artwork is shown at 56px CSS = ~112 device px on retina: take the
          // mid-size image (~300px), NOT the smallest (64px, blurry upscaled).
          const img = imgs.length > 1 ? imgs[imgs.length - 2] : imgs[0];
          setCover(img ? img.url : null);
          setProg({ pos: c.progress_ms || 0, dur: c.item.duration_ms || 0, at: Date.now(), playing: !!c.is_playing });
        }
        setPaused(!c.is_playing);
        setShuffle(!!c.shuffle_state);
        setRepeat(c.repeat_state === "context" ? "all" : c.repeat_state === "track" ? "one" : "off");
        if (c.device && c.device.id && !pickedRef.current) setDeviceId(c.device.id);
      } catch (e) {
        // If the token dies mid-session the poll would fail forever in
        // silence: after 2 consecutive 401s surface the reconnect CTA.
        if (e && e.status === 401) {
          if (++auth401Ref.current >= 2) setAuthErr(true);
        }
      }
    };
    // Poll only while the tab is visible (background polling wastes battery
    // and API quota); on return to visibility resync immediately.
    const id = setInterval(() => { if (!document.hidden) tick(); }, 3000);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    tick();
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [uris, setIndex]);

  // Local ticker: animates the bar between polls — only while playing.
  useEffect(() => {
    if (!prog.playing) return;
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [prog.playing]);

  const shown = Math.min(Math.max(liveIdx, 0), tracks.length - 1);
  const cur = tracks[shown];

  // A transport command that fails would otherwise LOOK like it worked
  // (optimistic UI) until the next poll: surface a hint instead.
  const cmdFail = () => setMsg("Command didn't reach Spotify — check the device, then press ⟳.");

  const toggle = async () => {
    try {
      if (paused) { await spotifyResume(); setPaused(false); }
      else { await spotifyPause(); setPaused(true); }
    } catch (e) { cmdFail(); }
  };
  const goPrev = () => { spotifyPrevious().then(() => setMsg("")).catch(cmdFail); };
  const goNext = () => { spotifyNext().then(() => setMsg("")).catch(cmdFail); };
  const onPickDevice = (id) => {
    pickedRef.current = true;
    setDeviceId(id);
    spotifyTransfer(id, true).catch(cmdFail); // move current playback (no restart)
  };

  const toggleShuffle = async () => {
    const next = !shuffle; setShuffle(next);
    try { await spotifyShuffle(next); } catch (e) { setShuffle(!next); }
  };
  const cycleRepeat = async () => {
    const prev = repeat;
    const nextOf = { off: "all", all: "one", one: "off" };
    const next = nextOf[repeat];
    const api = next === "all" ? "context" : next === "one" ? "track" : "off";
    setRepeat(next);
    try { await spotifyRepeat(api); } catch (e) { setRepeat(prev); }
  };

  // ✕ = silence, not just "hide the panel": pause the device before closing
  // (best effort — the panel closes regardless).
  const closePlayer = () => {
    spotifyPause().catch(() => {});
    onClose();
  };

  const many = tracks.length > 1;
  if (!cur) return null;

  const posDisp = prog.playing ? Math.min(prog.dur, prog.pos + (Date.now() - prog.at)) : prog.pos;
  const pct = prog.dur > 0 ? Math.min(100, (posDisp / prog.dur) * 100) : 0;
  const onSeek = (e) => {
    if (!prog.dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const ms = frac * prog.dur;
    setProg((p) => ({ ...p, pos: ms, at: Date.now() }));
    spotifySeek(ms).catch(() => {});
  };

  return (
    <Shell bottomGap={bottomGap} onHeight={onHeight}>
      {/* now playing: artwork + title (tap → show on the map) + close */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px 6px" }}>
        {cover
          ? <img src={cover} alt="" width={56} height={56} style={{ borderRadius: 6, flexShrink: 0, objectFit: "cover", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }} />
          : <div style={{ width: 56, height: 56, borderRadius: 6, background: "rgba(154,147,138,0.25)", flexShrink: 0 }} />}
        <button
          onClick={() => onOpenTrack && onOpenTrack(cur.id)}
          title="Show on the map"
          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: onOpenTrack ? "pointer" : "default" }}
        >
          <div style={{ fontSize: 12.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur.title}<span style={{ color: MUTED }}> — {cur.artist}</span>
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>
            <span style={{ color: GREEN, fontWeight: 600 }}>● Spotify</span>{many ? ` · ${shown + 1}/${tracks.length}` : ""}
          </div>
        </button>
        <button
          onClick={() => setDevicesOpen((v) => !v)}
          title="Choose the playback device"
          aria-label="Choose the playback device"
          style={tglBtn(devicesOpen)}
        >
          🔊
        </button>
        <button onClick={closePlayer} title="Pause and close" aria-label="Pause and close" style={navBtn}>✕</button>
      </div>

      {/* progress + seek: the visible bar is 6px but the pointer target is
          ~20px tall (invisible padding) — seekable with a thumb, not a sniper */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 2px" }}>
        <span style={{ fontSize: 10, color: MUTED, width: 32, textAlign: "right" }}>{fmtTime(posDisp)}</span>
        <div onClick={onSeek} style={{ flex: 1, padding: "7px 0", cursor: "pointer" }}>
          <div style={{ height: 6, borderRadius: 3, background: "rgba(154,147,138,0.3)", position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: INK, borderRadius: 3 }} />
          </div>
        </div>
        <span style={{ fontSize: 10, color: MUTED, width: 32 }}>{fmtTime(prog.dur)}</span>
      </div>

      {/* transport: five controls distributed along the row (capped width so
          desktop doesn't scatter them), round play/pause as the centrepiece */}
      <div style={{ padding: "0 26px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 340, margin: "0 auto" }}>
          <button onClick={toggleShuffle} title="Shuffle the route" aria-label="Shuffle" style={tglBtn(shuffle)}>⇄</button>
          <button onClick={goPrev} disabled={!many} title="Previous" aria-label="Previous track" style={{ ...navBtn, opacity: many ? 1 : 0.35 }}>‹</button>
          <button onClick={toggle} title={paused ? "Resume" : "Pause"} aria-label={paused ? "Resume" : "Pause"} style={playBtn}>{paused ? "▶" : "❚❚"}</button>
          <button onClick={goNext} disabled={!many} title="Next" aria-label="Next track" style={{ ...navBtn, opacity: many ? 1 : 0.35 }}>›</button>
          <button onClick={cycleRepeat} title={`Repeat: ${repeat}`} aria-label={`Repeat: ${repeat}`} style={tglBtn(repeat !== "off")}>{repeat === "one" ? "₁⟲" : "⟲"}</button>
        </div>
      </div>

      {/* device picker: hidden by default (needed ~once per session), opened
          by the 🔊 button — or automatically when playback finds no device */}
      {devicesOpen && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 10px" }}>
          <span style={{ fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>Play on</span>
          <select
            value={deviceId || ""}
            onChange={(e) => onPickDevice(e.target.value)}
            style={{
              flex: 1, minWidth: 0, fontFamily: "Inter, sans-serif", fontSize: 12, color: INK,
              background: "rgba(255,255,255,0.7)", border: `1px solid rgba(154,147,138,0.5)`,
              borderRadius: 6, padding: "5px 8px",
            }}
          >
            {devices.length === 0 && <option value="">no device — open Spotify</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}{d.type === "Smartphone" ? " (phone)" : ""}{d.is_active ? " ·active" : ""}
              </option>
            ))}
          </select>
          <button onClick={refreshDevices} title="Refresh devices" aria-label="Refresh devices" style={navBtn}>⟳</button>
        </div>
      )}

      {authErr ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 10px", fontSize: 11, color: "#9a5b3a" }}>
          <span style={{ flex: 1 }}>Spotify session expired.</span>
          {onLogin && (
            <button onClick={onLogin} title="Reconnect to Spotify" style={{ ...navBtn, fontSize: 11, color: PAPER, background: GREEN, borderColor: GREEN }}>
              Reconnect
            </button>
          )}
        </div>
      ) : msg && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 10px", fontSize: 11, color: "#9a5b3a" }}>
          <span style={{ flex: 1, wordBreak: "break-word" }}>{msg}</span>
          <button onClick={() => { setMsg(""); playFrom(shown); }} title="Retry" style={navBtn}>⟳</button>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
//  EMBED: anteprima ~30s + opt-in "Ascolta intero"
// ---------------------------------------------------------------------------
function EmbedPlayer({ tracks, index, setIndex, onClose, bottomGap, onLogin, onHeight }) {
  const hostRef = useRef(null);
  const ctrlRef = useRef(null);
  const advancingRef = useRef(false);
  const tracksRef = useRef(tracks);
  const idxRef = useRef(index);
  const setIndexRef = useRef(setIndex);
  tracksRef.current = tracks;
  idxRef.current = index;
  setIndexRef.current = setIndex;

  const cur = tracks[index];
  const many = tracks.length > 1;

  useEffect(() => {
    let cancelled = false;
    const first = tracksRef.current[idxRef.current];
    loadSpotifyApi().then((API) => {
      if (cancelled || !hostRef.current || ctrlRef.current) return;
      const opts = { uri: first ? `spotify:track:${first.id}` : undefined, width: "100%", height: 80 };
      API.createController(hostRef.current, opts, (ctrl) => {
        if (cancelled) { try { ctrl.destroy(); } catch (e) { /* noop */ } return; }
        ctrlRef.current = ctrl;
        ctrl.addListener("playback_update", (e) => {
          const d = e && e.data;
          if (!d) return;
          const pos = d.position || 0;
          const dur = d.duration || 0;
          const nearEnd = dur > 0 && pos > 0 && pos / dur >= 0.985;
          const previewEnd = dur > 45000 && pos >= 29000 && d.isPaused;
          if ((nearEnd || previewEnd) && !advancingRef.current) {
            advancingRef.current = true;
            const t = tracksRef.current;
            const i = idxRef.current;
            if (i < t.length - 1) setIndexRef.current(i + 1);
          }
        });
        try { ctrl.play(); } catch (e) { /* il primo play puo' richiedere il gesto */ }
      });
    });
    return () => {
      cancelled = true;
      try { ctrlRef.current && ctrlRef.current.destroy(); } catch (e) { /* noop */ }
      ctrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    advancingRef.current = false;
    const ctrl = ctrlRef.current;
    if (ctrl && cur) {
      try { ctrl.loadUri(`spotify:track:${cur.id}`); ctrl.play(); } catch (e) { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cur && cur.id]);

  if (!cur) return null;

  return (
    <Shell bottomGap={bottomGap} onHeight={onHeight}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        {many && <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} title="Previous" style={navBtn}>‹</button>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur.title}<span style={{ color: MUTED }}> — {cur.artist}</span>
          </div>
          {many && <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>route · {index + 1}/{tracks.length}</div>}
        </div>
        {many && <button onClick={() => setIndex(Math.min(tracks.length - 1, index + 1))} disabled={index === tracks.length - 1} title="Next" style={navBtn}>›</button>}
        <button onClick={onClose} title="Close player" style={navBtn}>✕</button>
      </div>
      <div ref={hostRef} style={{ width: "100%" }} />
      {onLogin && (
        <button onClick={onLogin} title="Play full tracks (requires Spotify Premium)" style={fullBtn}>
          ♫ Listen full · Spotify Premium
        </button>
      )}
    </Shell>
  );
}

function Shell({ children, bottomGap, onHeight }) {
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
      {children}
    </div>
  );
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const navBtn = {
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
const tglBtn = (active) => ({
  ...navBtn,
  color: active ? PAPER : INK,
  background: active ? INK : "transparent",
  borderColor: active ? INK : "rgba(154,147,138,0.5)",
});
// play/pause: the transport's round centrepiece, bigger than the rest
const playBtn = {
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
const fullBtn = {
  display: "block",
  width: "100%",
  fontFamily: "Inter, sans-serif",
  fontSize: 12,
  fontWeight: 600,
  color: PAPER,
  background: GREEN,
  border: "none",
  padding: "9px 12px",
  cursor: "pointer",
};
