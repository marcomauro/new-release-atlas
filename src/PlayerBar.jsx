import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import {
  spotifyStartOn, spotifyPause, spotifyResume, spotifyDevices, spotifyState, spotifyTransfer,
  spotifyNext, spotifyPrevious, spotifySeek, spotifyShuffle, spotifyRepeat, connectBusy,
} from "./spotifyConnect.js";
import { INK, PAPER, MUTED } from "./theme.js";
import {
  Shell, Marquee, ProgressRow, TransportRow, SourceSwitch, navBtn, tglBtn,
} from "./playerChrome.jsx";
import YouTubePlayer from "./YouTubePlayer.jsx";

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

/* Mini-player persistente del PERCORSO. La sorgente di ascolto (`source`)
   sceglie il motore; `sources` sono quelle offerte dallo switch nel player.
   - YOUTUBE: brani INTERI per tutti, senza account (IFrame API, un brano
     alla volta; la coda la tiene l'app — vedi YouTubePlayer.jsx).
   - SPOTIFY · CONNECT (utente loggato a Spotify Premium): pilota il device
     dell'utente via Web API → brani INTERI in sequenza (anche su mobile).
   - SPOTIFY · EMBED (non loggato): l'embed ufficiale, anteprima ~30s, con
     pulsante opt-in "Ascolta intero" per attivare il Connect. */
export default function PlayerBar({
  tracks, index, setIndex, onClose, bottomGap = 0, connected, onLogin, isMobile, onOpenTrack, onHeight,
  source = "spotify", sources = ["spotify"], onSource,
}) {
  const sw = { sources, onSource };
  if (source === "youtube") {
    return (
      <YouTubePlayer
        tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap}
        isMobile={isMobile} onOpenTrack={onOpenTrack} onHeight={onHeight} {...sw}
      />
    );
  }
  if (connected) {
    return (
      <ConnectPlayer
        tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap}
        isMobile={isMobile} onOpenTrack={onOpenTrack} onHeight={onHeight} onLogin={onLogin} {...sw}
      />
    );
  }
  return (
    <EmbedPlayer
      tracks={tracks} index={index} setIndex={setIndex} onClose={onClose} bottomGap={bottomGap} onLogin={onLogin} onHeight={onHeight} {...sw}
    />
  );
}

// ---------------------------------------------------------------------------
//  CONNECT: full track sul device dell'utente (Premium)
// ---------------------------------------------------------------------------
function ConnectPlayer({ tracks, index, setIndex, onClose, bottomGap, isMobile, onOpenTrack, onHeight, onLogin, sources, onSource }) {
  const uris = useMemo(() => tracks.map((t) => `spotify:track:${t.id}`), [tracks]);
  const [paused, setPaused] = useState(false);
  const [liveIdx, setLiveIdx] = useState(index);
  const [msg, setMsg] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [devicesOpen, setDevicesOpen] = useState(false); // device row hidden until asked
  // reconnect CTA: "expired" = token died mid-session; "scope" = token from
  // before the route playlist, it cannot write it
  const [authErr, setAuthErr] = useState(null);
  const [cover, setCover] = useState(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off"); // off | all | one
  const [prog, setProg] = useState({ pos: 0, dur: 0, at: 0, playing: false });
  const [, force] = useState(0);
  const pickedRef = useRef(false);       // did the user pick a device manually?
  const auth401Ref = useRef(0);          // consecutive 401s from the state poll
  const deviceIdRef = useRef(null);      // latest deviceId, for async closures
  const startGenRef = useRef(0);         // start-sequence generation: stale starts bail out
  useEffect(() => { deviceIdRef.current = deviceId; }, [deviceId]);

  const refreshDevices = useCallback(async () => {
    try { const ds = await spotifyDevices(); setDevices(ds); return ds; }
    catch (e) { return []; }
  }, []);

  // Which device should play? A manual pick always wins. Otherwise: on mobile
  // the phone (it is in the user's hand), else whatever is already active,
  // else — on desktop — a computer, else the first one listed.
  const resolveDevice = useCallback(async () => {
    const ds = await refreshDevices();
    if (pickedRef.current) {
      const picked = ds.find((d) => d.id === deviceIdRef.current);
      if (picked) return picked;
    }
    const phone = ds.find((d) => d.type === "Smartphone");
    const active = ds.find((d) => d.is_active);
    const computer = ds.find((d) => d.type === "Computer");
    return (isMobile && phone) || active || (!isMobile && computer) || ds[0] || null;
  }, [refreshDevices, isMobile]);

  // Start (or restart) the route from `pos`: resolve the target device FIRST,
  // then hand off to spotifyStartOn (wake-then-play, serialized with every
  // other command). No play is ever fired blind before the device is known:
  // that blind play used to 404 and fall back to a direct play?device_id on
  // the inactive desktop client — the sequence that froze it. A newer start
  // (Regenerate pressed twice, ▶ Play right after Generate) supersedes one
  // that is still resolving its device.
  const playFrom = useCallback(async (pos) => {
    const gen = ++startGenRef.current;
    setMsg("");
    let dev = null;
    try {
      dev = await resolveDevice();
      if (gen !== startGenRef.current) return;
      if (!dev) {
        setMsg("Open Spotify on a device and play a track there for a moment, then press ⟳.");
        setDevicesOpen(true); // surface the device picker: that's what needs fixing
        return;
      }
      setDeviceId(dev.id);
      await spotifyStartOn(dev, uris, pos);
      if (gen === startGenRef.current) setPaused(false);
    } catch (e) {
      if (gen !== startGenRef.current) return;
      if (e.reason === "PLAYLIST_SCOPE") { setAuthErr("scope"); return; }
      setMsg(describeError(e, dev, "start"));
      if (e.status === 404 || e.reason === "NO_ACTIVE_DEVICE") { refreshDevices(); setDevicesOpen(true); }
    }
  }, [uris, resolveDevice, refreshDevices]);

  // Every playlist activation (generate / ▶ Play / restore / regenerate)
  // yields a new `uris` → always restart from track 0. Debounced a little so
  // two activations in the same breath send ONE start, not two overlapping.
  useEffect(() => {
    setLiveIdx(0);
    setProg({ pos: 0, dur: 0, at: Date.now(), playing: true });
    const t = setTimeout(() => playFrom(0), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uris]);

  // Poll stato completo: indice live, play/pausa, device, cover, progress,
  // shuffle/repeat. Propaga l'indice reale al genitore (evidenziazione sulla
  // mappa) senza far ripartire la riproduzione.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      // Skip the read while a command is in flight: the answer would describe
      // the state the device is leaving, and stacking requests on a client
      // that is switching context is what makes the desktop app freeze.
      if (connectBusy()) return;
      try {
        const c = await spotifyState();
        if (stop || !c) return;
        auth401Ref.current = 0;
        setAuthErr((a) => (a === "expired" ? null : a));
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
          if (++auth401Ref.current >= 2) setAuthErr("expired");
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
  // (optimistic UI) until the next poll: surface a hint naming the device.
  // Commands are serialized by the Connect layer, so a click during a start
  // waits its turn instead of colliding with it.
  const deviceById = (id) => devices.find((d) => d.id === id) || null;
  const cmd = (fn, dev = deviceById(deviceId)) =>
    fn().then(() => setMsg("")).catch((e) => setMsg(describeError(e, dev, "command")));

  const toggle = () => cmd(async () => {
    if (paused) { await spotifyResume(); setPaused(false); }
    else { await spotifyPause(); setPaused(true); }
  });
  const goPrev = () => cmd(spotifyPrevious);
  const goNext = () => cmd(spotifyNext);
  const onPickDevice = (id) => {
    pickedRef.current = true;
    setDeviceId(id);
    cmd(() => spotifyTransfer(id, true), deviceById(id)); // move current playback (no restart)
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
  // (best effort — the panel closes regardless). The pause is queued like any
  // command, so a playlist started right after cannot be overtaken by it.
  const closePlayer = () => {
    spotifyPause().catch(() => {});
    onClose();
  };
  // Switching to another source silences the Spotify device first, like ✕.
  const switchSource = onSource && ((s) => {
    spotifyPause().catch(() => {});
    onSource(s);
  });

  const many = tracks.length > 1;
  if (!cur) return null;

  const posDisp = prog.playing ? Math.min(prog.dur, prog.pos + (Date.now() - prog.at)) : prog.pos;
  const onSeek = (ms) => {
    setProg((p) => ({ ...p, pos: ms, at: Date.now() }));
    spotifySeek(ms).catch(() => {});
  };

  return (
    <Shell bottomGap={bottomGap} onHeight={onHeight}>
      {/* Spotify-style layout: big artwork fills the LEFT side; the RIGHT
          column stacks title → progress bar → transport controls. */}
      <div style={{ display: "flex", alignItems: "stretch", gap: 12, padding: "10px 12px 8px" }}>
        {cover
          ? <img src={cover} alt="" width={96} height={96} style={{ borderRadius: 8, flexShrink: 0, objectFit: "cover", alignSelf: "center", boxShadow: "0 3px 12px rgba(0,0,0,0.22)" }} />
          : <div style={{ width: 96, height: 96, borderRadius: 8, background: "rgba(154,147,138,0.25)", flexShrink: 0, alignSelf: "center" }} />}

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 4 }}>
          {/* row 1: title (marquee when it overflows) + device + close */}
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
                <SourceSwitch active="spotify" sources={sources} onSource={switchSource} />{many ? ` · ${shown + 1}/${tracks.length}` : ""}
              </div>
            </div>
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

          {/* row 2: progress + seek */}
          <ProgressRow pos={posDisp} dur={prog.dur} onSeek={onSeek} />

          {/* row 3: transport distributed along the column width */}
          <TransportRow
            shuffle={shuffle} onShuffle={toggleShuffle} many={many} onPrev={goPrev} onNext={goNext}
            paused={paused} onToggle={toggle} repeat={repeat} onRepeat={cycleRepeat}
          />
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
          <span style={{ flex: 1 }}>
            {authErr === "scope"
              ? "Atlas now plays routes from its own private playlist on your Spotify — reconnect once to allow it."
              : "Spotify session expired."}
          </span>
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
function EmbedPlayer({ tracks, index, setIndex, onClose, bottomGap, onLogin, onHeight, sources, onSource }) {
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
          {(many || sources.length > 1) && (
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>
              <SourceSwitch active="spotify" sources={sources} onSource={onSource} />{many ? ` · route ${index + 1}/${tracks.length}` : ""}
            </div>
          )}
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

// Error → one actionable line. A timeout or 502/503/504 means the Connect
// backend got no answer from the client: on macOS that is typically the
// Spotify app napping in the background, or still busy switching context.
function describeError(e, dev, kind) {
  const name = dev && dev.name ? `“${dev.name}”` : "the device";
  if (!e) return "Couldn't reach Spotify.";
  if (e.reason === "TIMEOUT" || e.status === 502 || e.status === 503 || e.status === 504) {
    return `Spotify on ${name} isn't responding — bring the Spotify window to the front (or play a track there once), then press ⟳.`;
  }
  if (e.status === 404 || e.reason === "NO_ACTIVE_DEVICE") {
    return `Open Spotify on ${name} and play a track for a moment, then press ⟳.`;
  }
  if (e.status === 403) {
    return e.reason === "PREMIUM_REQUIRED" || kind === "start"
      ? "Full playback requires Spotify Premium."
      : "Spotify refused that command — try again in a moment.";
  }
  if (e.status === 401) return "Spotify session expired — reconnect.";
  if (e.reason === "NETWORK") return "No connection to Spotify — check the network, then press ⟳.";
  return kind === "start"
    ? "Couldn't start playback on Spotify."
    : "Command didn't reach Spotify — check the device, then press ⟳.";
}

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
