import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  spotifyPlay, spotifyPause, spotifyResume, spotifyDevices, spotifyCurrentlyPlaying,
} from "./spotifyConnect.js";

const INK = "#2b2724";
const PAPER = "#f4f1ea";
const MUTED = "#9a938a";
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
export default function PlayerBar({ tracks, index, setIndex, onClose, bottomGap = 0, connected, onLogin, isMobile }) {
  if (connected) {
    return (
      <ConnectPlayer
        tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap} isMobile={isMobile}
      />
    );
  }
  return (
    <EmbedPlayer
      tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap} onLogin={onLogin}
    />
  );
}

// ---------------------------------------------------------------------------
//  CONNECT: full track sul device dell'utente (Premium)
// ---------------------------------------------------------------------------
function ConnectPlayer({ tracks, index, setIndex, onClose, bottomGap, isMobile }) {
  const uris = useMemo(() => tracks.map((t) => `spotify:track:${t.id}`), [tracks]);
  const [paused, setPaused] = useState(false);
  const [liveIdx, setLiveIdx] = useState(index);
  const [msg, setMsg] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const pickedRef = useRef(false); // l'utente ha scelto un device a mano?

  const refreshDevices = useCallback(async () => {
    try {
      const ds = await spotifyDevices();
      setDevices(ds);
      return ds;
    } catch (e) {
      return [];
    }
  }, []);

  // Scelta iniziale del device: su mobile preferisci lo Smartphone, altrimenti
  // il device attivo, altrimenti il primo disponibile.
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
            (isMobile && ds.find((d) => d.type === "Smartphone")) ||
            ds[0];
          if (target) {
            try {
              await spotifyPlay(uris, pos, target.id);
              setDeviceId(target.id);
              setPaused(false);
              return;
            } catch (e2) { /* fallthrough */ }
          }
          setMsg("Open Spotify on the device and play a track for a moment, then press ⟳.");
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

  // (Ri)avvia al cambio di brano, percorso o device scelto.
  useEffect(() => {
    playFrom(index);
    setLiveIdx(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playFrom]);

  // Poll leggero: allinea indice mostrato + stato play/pausa + device attivo.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const c = await spotifyCurrentlyPlaying();
        if (stop || !c) return;
        if (c.item && c.item.uri) {
          const i = uris.indexOf(c.item.uri);
          if (i >= 0) setLiveIdx(i);
        }
        setPaused(!c.is_playing);
        if (c.device && c.device.id && !pickedRef.current) setDeviceId(c.device.id);
      } catch (e) { /* noop */ }
    };
    const id = setInterval(tick, 5000);
    tick();
    return () => { stop = true; clearInterval(id); };
  }, [uris]);

  const toggle = async () => {
    try {
      if (paused) { await spotifyResume(); setPaused(false); }
      else { await spotifyPause(); setPaused(true); }
    } catch (e) { /* noop */ }
  };

  const onPickDevice = (id) => {
    pickedRef.current = true;
    setDeviceId(id); // il play effect ritrasferisce e riavvia su quel device
  };

  const shown = Math.min(Math.max(liveIdx, 0), tracks.length - 1);
  const cur = tracks[shown];
  const many = tracks.length > 1;
  if (!cur) return null;

  return (
    <Shell bottomGap={bottomGap}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <span title="Playing on Spotify" style={{ color: GREEN, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>● Spotify</span>
        {many && <button onClick={() => setIndex(Math.max(0, shown - 1))} disabled={shown === 0} title="Previous" style={navBtn}>‹</button>}
        <button onClick={toggle} title={paused ? "Resume" : "Pause"} style={navBtn}>{paused ? "▶" : "❚❚"}</button>
        {many && <button onClick={() => setIndex(Math.min(tracks.length - 1, shown + 1))} disabled={shown === tracks.length - 1} title="Next" style={navBtn}>›</button>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur.title}<span style={{ color: MUTED }}> — {cur.artist}</span>
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>
            full track{many ? ` · route ${shown + 1}/${tracks.length}` : ""}
          </div>
        </div>
        <button onClick={onClose} title="Close player" style={navBtn}>✕</button>
      </div>

      {/* selettore device "Riproduci su…" */}
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
        <button onClick={refreshDevices} title="Refresh devices" style={navBtn}>⟳</button>
      </div>

      {msg && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 10px", fontSize: 11, color: "#9a5b3a" }}>
          <span style={{ flex: 1 }}>{msg}</span>
          <button onClick={() => playFrom(shown)} title="Retry" style={navBtn}>⟳</button>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
//  EMBED: anteprima ~30s + opt-in "Ascolta intero"
// ---------------------------------------------------------------------------
function EmbedPlayer({ tracks, index, setIndex, onClose, bottomGap, onLogin }) {
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
    <Shell bottomGap={bottomGap}>
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

function Shell({ children, bottomGap }) {
  return (
    <div
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
