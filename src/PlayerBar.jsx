import React, { useEffect, useRef } from "react";

const INK = "#2b2724";
const MUTED = "#9a938a";

// Carica una sola volta l'API iFrame ufficiale di Spotify.
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

/* Mini-player persistente per l'ascolto continuo di un PERCORSO.
   Usa l'API iFrame di Spotify: carica il brano corrente, e quando finisce
   (fine brano intero, o fine anteprima ~30s) avanza da solo al successivo.
   Prev/Next manuali sempre disponibili. */
export default function PlayerBar({ tracks, index, setIndex, onClose, bottomGap = 0 }) {
  const hostRef = useRef(null); // div che l'API trasforma in iframe
  const ctrlRef = useRef(null);
  const advancingRef = useRef(false);
  // ref aggiornati per l'uso dentro i listener (che vivono oltre i render)
  const tracksRef = useRef(tracks);
  const idxRef = useRef(index);
  const setIndexRef = useRef(setIndex);
  tracksRef.current = tracks;
  idxRef.current = index;
  setIndexRef.current = setIndex;

  const cur = tracks[index];
  const many = tracks.length > 1;

  // Crea il controller una sola volta e aggancia l'auto-avanzamento.
  useEffect(() => {
    let cancelled = false;
    const first = tracksRef.current[idxRef.current];
    loadSpotifyApi().then((API) => {
      if (cancelled || !hostRef.current || ctrlRef.current) return;
      const opts = {
        uri: first ? `spotify:track:${first.id}` : undefined,
        width: "100%",
        height: 80,
      };
      API.createController(hostRef.current, opts, (ctrl) => {
        if (cancelled) {
          try { ctrl.destroy(); } catch (e) { /* noop */ }
          return;
        }
        ctrlRef.current = ctrl;
        ctrl.addListener("playback_update", (e) => {
          const d = e && e.data;
          if (!d) return;
          const pos = d.position || 0;
          const dur = d.duration || 0;
          // fine brano intero (frazione, robusta all'unita') oppure fine
          // anteprima ~30s (solo se la durata e' quella del brano intero in ms)
          const nearEnd = dur > 0 && pos > 0 && pos / dur >= 0.985;
          const previewEnd = dur > 45000 && pos >= 29000 && d.isPaused;
          if ((nearEnd || previewEnd) && !advancingRef.current) {
            advancingRef.current = true;
            const t = tracksRef.current;
            const i = idxRef.current;
            if (i < t.length - 1) setIndexRef.current(i + 1);
          }
        });
      });
    });
    return () => {
      cancelled = true;
      try { ctrlRef.current && ctrlRef.current.destroy(); } catch (e) { /* noop */ }
      ctrlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al cambio di brano: carica il nuovo e prova a riprodurlo.
  useEffect(() => {
    advancingRef.current = false;
    const ctrl = ctrlRef.current;
    if (ctrl && cur) {
      try {
        ctrl.loadUri(`spotify:track:${cur.id}`);
        ctrl.play();
      } catch (e) { /* il primo play puo' richiedere il gesto utente */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, cur && cur.id]);

  if (!cur) return null;

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}>
        {many && (
          <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} title="Precedente" style={navBtn}>
            ‹
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {cur.title}
            <span style={{ color: MUTED }}> — {cur.artist}</span>
          </div>
          {many && (
            <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>
              percorso · {index + 1}/{tracks.length}
            </div>
          )}
        </div>
        {many && (
          <button onClick={() => setIndex(Math.min(tracks.length - 1, index + 1))} disabled={index === tracks.length - 1} title="Successivo" style={navBtn}>
            ›
          </button>
        )}
        <button onClick={onClose} title="Chiudi player" style={navBtn}>
          ✕
        </button>
      </div>
      <div ref={hostRef} style={{ width: "100%" }} />
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
