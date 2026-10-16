# Piano: svincolare Atlas da Spotify

> Stato: **proposta** · Data della ricerca: 2026-10-16 · Nessuna modifica al codice
> è ancora stata fatta: questo documento è la base per decidere e poi procedere per fasi.

Obiettivo: chiunque deve poter **ascoltare** la mappa (senza un account o con quello
che già ha) e chiunque deve poter **curare** un proprio Atlas. Spotify diventa una
sorgente tra tante, non il fondamento dell'app.

---

## 1. Perché adesso: cosa è cambiato su Spotify

| Data | Cambiamento | Effetto su Atlas |
|---|---|---|
| nov 2024 | Rimossi per le app nuove/dev-mode: `audio-features`, `recommendations`, `preview_url` (ora `null`) | Già assorbito: mood/bpm vengono dall'arricchimento AI, non da Spotify |
| mag 2025 | Extended quota solo per **organizzazioni registrate con ≥250k MAU** | Un progetto personale non può più uscire dalla Development Mode |
| feb–mar 2026 | Development Mode: l'owner deve avere **Premium**, **max 5 utenti autorizzati** per Client ID, endpoint batch rimossi, search limitata a 10 risultati | **La modalità Connect (brani interi) funziona solo per 5 persone in allowlist**: non può essere "aperta a tutti" |
| lug 2026 | Quota contata per account, 429 `QUOTA_EXCEEDED` | Ulteriore fragilità |

L'unica parte di Spotify utilizzabile dal pubblico è l'**embed** (anteprime ~30 s
per chi non è loggato). Conclusione: restare su Spotify significa che il
pubblico ascolta solo anteprime e che il "brano intero" resta un privilegio
dell'owner.

Fonti principali: developer.spotify.com/blog/2024-11-27-changes-to-the-web-api,
developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security,
developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide,
developer.spotify.com/blog/2026-07-23-web-api-quota-updates.

---

## 2. Dove il progetto dipende da Spotify (audit del codice)

La buona notizia: **il cuore dell'app è già neutrale**. Grafo, generi, mood,
bpm, motore delle playlist (`src/playlist.js`), pesi e layout non usano
nessun dato Spotify. La dipendenza è concentrata in tre punti.

| Area | File | Natura della dipendenza |
|---|---|---|
| **Identità dei brani** | `data/spotify_archive_enriched.json`, `scripts/add_playlist.py`, `build_graph.py`, `dedupe_tracks.py`, `check_archive.py`, `src/graph/hydrate.js` | La chiave primaria di ogni brano è `spotify_track_id`; `url` è derivato da quell'id; nessun ISRC né MBID nell'archivio. `support.json`/`char.json` sono indicizzati per id Spotify |
| **Riproduzione** | `src/PlayerBar.jsx` (585 righe), `src/spotifyConnect.js`, `src/connectTransport.js`, `src/components/DetailPanel.jsx` (iframe), `src/MusicNetwork.jsx` (login, preload API) | Due player entrambi Spotify (Embed 30 s / Connect Premium). In Connect la **coda del percorso è delegata a Spotify** (`uris[]` + polling di `/me/player`) |
| **Export** | `src/export.js`, `PlaylistHub.jsx`, `MusicNetwork.jsx` | Solo link Spotify + Spotlistr; CSV con colonna `spotify_url` |
| Testi / docs | README, `docs/ADDING_PLAYLISTS.md`, label UI ("Open in Spotify", "Listen full · Spotify Premium", colore `#1db954`) | Cosmetico |

Vincolo da rispettare: `tests/test_unicode_safety.py` vieta di normalizzare/troncare
i titoli nella pipeline. Il matching cross-piattaforma dovrà normalizzare **solo
chiavi di confronto temporanee**, mai i campi salvati.

---

## 3. Panorama delle alternative (ricerca)

### 3.1 Piattaforme di riproduzione

| Sorgente | Account utente | Costo per noi | Brano intero? | Solo client (statico)? | Lookup per ISRC | Vincoli |
|---|---|---|---|---|---|---|
| **YouTube IFrame Player** | no | gratis | **sì** (con pubblicità) | sì | no (serve search: 100 unità/chiamata, 10k/giorno) | Player visibile ≥200×200, niente audio-only/background, alcuni video non embeddabili (err. 101/150) |
| **Apple MusicKit JS v3** | abbonato Apple Music per l'intero, nessuno per anteprime | 99 $/anno (Apple Developer) | sì (abbonati) / 30 s (altri) | sì, con developer token **firmato offline in CI** (max 6 mesi, claim `origin`) | **sì** (`filter[isrc]`, per storefront) | Badge/attribuzione; HTTPS obbligatorio |
| **iTunes Search/Lookup API** | no | gratis | 30 s (`previewUrl`) | sì (JSONP `callback`) | no (lookup per id/termine) | ~20 req/min/IP; anteprime accompagnate da link allo store |
| **Deezer API pubblica** | no | gratis | 30 s (`preview` MP3) | ⚠️ niente CORS; JSONP storico da verificare | **sì** (`/track/isrc:XXX`) | Registrazione nuove app **chiusa** da metà 2025 → niente OAuth/full |
| **Spotify Embed** | no (anteprima) | gratis | 30 s (intero solo se loggato) | sì | — | UI Spotify obbligatoria |
| **Spotify Connect / Web API** | Premium | Premium dell'owner | sì | sì (PKCE) | sì (search `isrc:`) | **5 utenti** in Dev Mode |
| **TIDAL** (openapi + `@tidal-music/player`) | sì | gratis | **no**: alle app terze il server restituisce `PREVIEW` | parziale | sì (`filter[isrc]`) | Full playback annunciato dal 2024, mai arrivato |
| **SoundCloud Widget** | no | gratis (API: Artist Pro a pagamento) | sì se il brano è libero | sì (eventi `FINISH` ecc.) | no | Copertura major scarsa, buona per club/underground |
| **Bandcamp embed** | no | gratis | sì (se l'artista lo consente) | iframe | no | Nessuna API JS/eventi: non concatenabile; nessuna API di ricerca |
| **Subsonic/OpenSubsonic** (Navidrome…) — "porta il tuo server" | credenziali del *proprio* server | gratis | **sì** (file propri) | sì (Navidrome manda CORS `*`; auth `apiKey` o token+salt) | via `search3` / `musicBrainzId` | Sito HTTPS non può usare server `http://` in LAN (mixed content) |
| Amazon Music, Qobuz | — | — | — | — | — | Nessuna API pubblica utilizzabile |

### 3.2 Identità e metadati aperti

- **ISRC** — identifica la registrazione; cercabile su Apple, Deezer, TIDAL,
  Spotify, MusicBrainz. Limiti: edit/remix/live hanno ISRC propri, una stessa
  registrazione può averne più d'uno. → salvare **una lista** `isrcs[]`.
- **MusicBrainz recording MBID** — miglior chiave neutrale (raggruppa più ISRC,
  dati CC0), ma copertura incompleta sulle uscite recenti/underground.
  Limite 1 req/s con User-Agent obbligatorio → si interroga **offline**, mai dal browser.
  `/ws/2/url?resource=…` accetta fino a 100 URL per richiesta (verificato nel sorgente).
- **ListenBrainz `metadata/lookup`** — artista+titolo → MBID, con CORS.
- **Cover Art Archive** — copertine per release MBID (hotlink con attribuzione;
  le immagini non sono CC0).
- **Odesli/song.link API: da NON usare** — l'accesso senza chiave risulta
  dismesso (401 `PUBLIC_API_ACCESS_DEPRECATED`, sunset annunciato per il 31/07/2026).
  Anche Songwhip è chiuso. Lezione: **ogni servizio di terzi può sparire** →
  risolvere offline e salvare il risultato nel repo.

### 3.3 Architettura di riferimento: ListenBrainz BrainzPlayer

Il player open source di ListenBrainz (metabrainz/listenbrainz-server,
`frontend/js/src/common/brainzplayer/`) fa esattamente ciò che serve:

- elenco **ordinato e configurabile dall'utente** di sorgenti (Spotify, Apple
  Music, SoundCloud, Funkwhale, Navidrome, YouTube, Internet Archive);
- se il brano ha già l'id nativo di una sorgente lo usa, altrimenti cerca per
  artista+titolo;
- se una sorgente fallisce → `onTrackNotFound` → passa alla successiva; dopo
  l'ultima salta il brano.

Atlas può fare meglio su un punto: avendo un archivio curato e chiuso, **gli id
nativi si risolvono tutti in anticipo** (build time), quindi a runtime non serve
nessuna ricerca, nessuna chiave API e nessun rate limit.

### 3.4 Formati di playlist aperti

- **JSPF** (JSON XSPF, con identificatori `https://musicbrainz.org/recording/<mbid>`)
  — accettato da ListenBrainz, che può poi esportare verso Spotify/Apple
  Music/SoundCloud (`POST /1/playlist/export-jspf/{service}` col token dell'utente).
- **XSPF** — standard storico, letto da VLC e altri.
- **CSV con ISRC** — TuneMyMusic dichiara di usare l'ISRC nel matching; Soundiiz accetta CSV.

---

## 4. Architettura proposta

```
           CURATORE (offline / CI)                                ASCOLTATORE (browser, statico)
 ┌───────────────────────────────────────────┐        ┌────────────────────────────────────────────┐
 │ import playlist da QUALSIASI sorgente     │        │ graph.json  (grafo, invariato)             │
 │ (Spotify, Apple, Deezer, CSV, JSPF)       │        │ sources.json (id per piattaforma, lazy)    │
 │            │                              │        │            │                               │
 │            ▼                              │        │            ▼                               │
 │ data/archive.json  ← atlas_id neutrale    │        │ RouteController (coda, indice, avanzamento)│
 │            │                              │        │            │                               │
 │            ▼                              │  build │            ▼                               │
 │ resolve_sources.py  ISRC→MBID→id nativi   │ ─────► │ Provider scelto dall'utente, con fallback: │
 │ (Spotify, MusicBrainz, Deezer, iTunes,    │        │  Anteprime aperte · YouTube · Apple Music  │
 │  YouTube; cache + override manuali)       │        │  Spotify · Il mio server (Subsonic)        │
 │            │                              │        │                                            │
 │            ▼                              │        │ Export: JSPF · XSPF · CSV(ISRC) · link     │
 │ data/sources.json + report di copertura   │        └────────────────────────────────────────────┘
 └───────────────────────────────────────────┘
```

### 4.1 Modello dati neutrale

Ogni brano unico ottiene un **`atlas_id`** opaco e stabile (calcolato una volta
all'ingresso nell'archivio, poi congelato; mai ricalcolato). Gli id di
piattaforma diventano attributi:

```jsonc
// data/archive.json — tracks_flat[] (campi nuovi o rinominati)
{
  "atlas_id": "t3k9q2",                 // NUOVA chiave primaria
  "isrcs": ["USXXX0000001"],            // 0..n
  "mbid": "…" ,                         // recording MBID, nullable
  "album": "…", "release_mbid": "…",    // per copertina (Cover Art Archive)
  "title": "…", "artists": ["…"], "duration_sec": 538,
  "genres": […], "mood_parameters": {…}, // arricchimento: INVARIATO
  "legacy_spotify_id": "58uRFOHOP3rnOgMqGnou91"  // per compatibilità/migrazione
}
```

```jsonc
// data/sources.json — separato: si rigenera senza toccare l'arricchimento
{
  "t3k9q2": {
    "spotify":    { "id": "58uRFOHOP3rnOgMqGnou91" },
    "apple":      { "id": "1440…", "matched_by": "isrc" },
    "deezer":     { "id": "3135…", "matched_by": "isrc" },
    "youtube":    { "id": "dQw4…", "matched_by": "search", "confidence": 0.86 },
    "soundcloud": { "url": "…", "matched_by": "manual" },
    "bandcamp":   { "url": "…", "matched_by": "manual" }
  }
}
```

- `public/graph.json` resta quasi identico (nodo `id` = `atlas_id`);
  `public/sources.json` (versione compatta) si carica **solo al primo Play**,
  così il caricamento della mappa non rallenta.
- `data/source_overrides.json`: correzioni manuali che vincono sempre sul
  risolutore (match sbagliato, versione YouTube preferita, link Bandcamp).
- Rinomina `data/spotify_archive_enriched.json` → `data/archive.json`
  (`build_graph.py` mantiene il vecchio nome come fallback per una release).

### 4.2 Pipeline di risoluzione (offline, stdlib come gli altri script)

`scripts/resolve_sources.py`, incrementale e con cache, eseguito in locale o
da un workflow GitHub Actions **manuale/schedulato che apre una PR** (non nel
deploy: il deploy resta deterministico e offline).

1. **ISRC**: Spotify `GET /tracks/{id}` → `external_ids.isrc` (una chiamata per
   brano, ~1 req/s; il campo è stato ripristinato a marzo 2026). Una tantum per
   i 1022 brani esistenti; poi solo per i nuovi.
2. **MBID**: MusicBrainz `/ws/2/url` (100 URL per richiesta, anche URL album) e
   `/ws/2/isrc/{isrc}`; fallback ListenBrainz `metadata/lookup`.
3. **Id nativi**: Deezer `track/isrc:`; Apple `filter[isrc]` (se si attiva
   MusicKit) oppure iTunes Search con verifica durata; YouTube Data API search
   (artista + titolo, 100 unità → ~100 brani/giorno: il backlog si smaltisce in
   ~11 giorni via cache, poi ~20 brani/settimana stanno ampiamente nella quota).
4. **Punteggio di match**: ISRC esatto > MBID > (artista, titolo, durata ±3 s) con
   normalizzazione **solo in memoria** (feat., "- 12\" Version", accenti). Sotto
   soglia → finisce nel report "da verificare", non nel file.
5. **Report di copertura** per sorgente + un guard in CI (`check_sources.py`)
   che fallisce se la copertura "riproducibile senza account" scende sotto soglia.

Segreti (Spotify client secret, chiave YouTube, chiave `.p8` Apple) solo in
GitHub Actions secrets o in locale, **mai nel bundle**.

### 4.3 Riproduzione: provider intercambiabili

Il punto chiave del refactoring: **la coda la possiede l'app, non la piattaforma.**
Oggi in Connect la coda è passata a Spotify (`uris[]`) e l'app la insegue via
polling; con un'astrazione comune ogni provider riproduce *un brano alla volta*
e segnala la fine.

```js
// src/playback/provider.js — contratto comune
{
  id: "youtube", label: "YouTube",
  capabilities: { full: true, preview: false, needsAccount: false, background: false, needsVisibleSurface: true },
  available(track, sources) → boolean,   // ha un id risolto?
  mount(hostEl), unmount(),
  load(track) → Promise, play(), pause(), seek(ms),
  on("progress" | "ended" | "error", cb),
}
```

- `RouteController` (puro JS, testabile con `node --test` come
  `connectTransport.js`): indice, prev/next, shuffle/repeat, avanzamento a fine
  brano, **fallback** alla sorgente successiva su errore/timeout, salto se
  nessuna sorgente ha il brano.
- `PlayerBar` diventa una UI unica (copertina, titolo, barra, trasporto) che
  parla col controller; un piccolo selettore **"Ascolta con"** sostituisce il
  pulsante verde Spotify. Preferenza salvata in `localStorage`.

Provider previsti, in ordine di priorità di implementazione:

| # | Provider | Per chi | Note di implementazione |
|---|---|---|---|
| 1 | **Anteprime aperte** (iTunes preview → Deezer preview) | tutti, nessun account | `<audio>` nativo: UI nostra, eventi affidabili, funziona anche a schermo bloccato. URL di anteprima recuperati a runtime per id (le URL Deezer scadono) — da verificare JSONP/CORS nella fase 0 |
| 2 | **YouTube** | tutti, nessun account, **brani interi** | IFrame API; player visibile nel mini-player (≥200×200, rispettare le regole: niente overlay, niente audio nascosto); fallback automatico se il video non è embeddabile |
| 3 | **Spotify** (codice esistente spostato in `src/playback/spotify/`) | chi ha Spotify | Embed per tutti; Connect resta per l'owner e max 5 utenti — dichiarato come tale in UI |
| 4 | **Apple Music** (MusicKit JS) | abbonati Apple Music: brani interi; altri: anteprime | Richiede Apple Developer (99 $/anno); token firmato in CI ogni ≤6 mesi con claim `origin` |
| 5 | **Il mio server** (OpenSubsonic: Navidrome, Gonic…) | chi ha la propria libreria | URL server + API key salvati solo nel browser dell'utente; `search3` + `/rest/stream`; solo server HTTPS |
| 6 | **SoundCloud / Bandcamp** | catalogo underground | SoundCloud via Widget API (concatenabile); Bandcamp solo come link "Apri su…" (nessuna API eventi) |

Pannello dettaglio: al posto di "Open in Spotify ↗" una riga di link a tutte le
piattaforme risolte per quel brano. Copertine: Cover Art Archive (via MBID) →
artwork Apple/Deezer, con attribuzione, cache runtime nel service worker
(`vite.config.js` → `runtimeCaching`).

### 4.4 Export neutrale

Il pulsante ↗ Export offre:

- **JSPF** (MBID + titolo/artista + ISRC in estensione) e **XSPF**;
- **CSV universale**: `title, artist, album, isrc, duration, spotify_url, apple_url, deezer_url, youtube_url`
  (BOM UTF-8 come oggi) → importabile in TuneMyMusic/Soundiiz verso qualunque servizio;
- **"Crea su…" in un clic** via ListenBrainz (`export-jspf/{spotify|apple_music|soundcloud}`)
  con il token ListenBrainz dell'utente (opzionale);
- Spotlistr resta come scorciatoia specifica per Spotify.

### 4.5 Aperta a tutti: anche ai curatori

Per rendere Atlas un progetto che chiunque può usare per il proprio archivio:

- **Import da qualsiasi piattaforma** in `add_playlist.py`: `support.json` accetta
  `{"source": "spotify"|"apple"|"deezer"|"isrc"|"manual", "id": …}`; adattatori
  per CSV (TuneMyMusic/Soundiiz) e JSPF/XSPF. `char.json` indicizzato per
  `atlas_id` o per qualunque id di sorgente.
- **Dedup per ISRC/MBID**: `dedupe_tracks.py` può proporre automaticamente i
  doppioni singolo/album (stesso ISRC, id Spotify diversi) invece di richiedere
  l'id a mano.
- **Configurazione fuori dal codice**: `atlas.config.json` con titolo, owner,
  `base`, tassonomia generi (colori/label oggi cablati in `MusicNetwork.jsx` e
  `playlist.js`), provider abilitati. Un fork = un nuovo Atlas.
- **Licenza**: il repo oggi non ha un file `LICENSE`. Serve sceglierne una
  (es. MIT per il codice; i dati di arricchimento eventualmente CC BY o CC0).
- Guida "Crea il tuo Atlas" in `docs/`.

---

## 5. Roadmap per fasi

Ogni fase è un PR autonomo, deployabile, e **non rompe la fase precedente**:
fino alla fase 3 l'esperienza utente resta identica.

| Fase | Contenuto | Criterio di accettazione | Stima |
|---|---|---|---|
| **0. Spike di verifica** | Test reali da browser/CI dei punti non verificati (§7); campione di 50 brani: % trovati con ISRC su Deezer/Apple/MusicBrainz, % video YouTube embeddabili | Tabella di copertura reale; decisione go/no-go su ciascun provider | 1–2 gg |
| **1. Identità neutrale** | `atlas_id`, `isrcs`, `mbid`, `legacy_spotify_id`; rinomina archivio; script aggiornati; test; README/`ADDING_PLAYLISTS.md` | `build_graph.py` produce lo stesso grafo (stessi nodi/archi) con id nuovi; tutti i test verdi; restore della history con vecchi id funziona | 2–3 gg |
| **2. Risolutore** | `resolve_sources.py` + cache + override + report + `check_sources.py`; workflow manuale che apre PR | `sources.json` con copertura misurata; nessuna chiamata di rete nel deploy | 3–4 gg (+ ~11 gg di calendario per la quota YouTube) |
| **3. Astrazione player** | `RouteController` + contratto provider; Spotify spostato dentro come provider; `PlayerBar` unificato | Comportamento Spotify invariato; test `node --test` del controller (avanzamento, fallback, timeout) | 3–4 gg |
| **4. Ascolto per tutti** | Provider "Anteprime aperte" + YouTube; selettore "Ascolta con"; link multipiattaforma nel pannello; copertine aperte | Un visitatore senza account ascolta ≥95% del percorso (anteprima) e ≥X% a brano intero (X dalla fase 0) | 4–5 gg |
| **5. Export neutrale** | JSPF, XSPF, CSV universale, ListenBrainz opzionale | Playlist importata con successo su almeno 3 servizi da un unico export | 1–2 gg |
| **6. Provider opzionali** | Apple MusicKit, Il mio server (Subsonic), SoundCloud | Ciascuno attivabile/disattivabile da config senza toccare gli altri | 2–3 gg ciascuno |
| **7. Template per curatori** | Import multi-sorgente, `atlas.config.json`, licenza, guida "Crea il tuo Atlas" | Un fork con un CSV di 50 brani produce un Atlas funzionante seguendo solo la guida | 3–4 gg |

Percorso minimo consigliato per avere subito un'app aperta: **0 → 1 → 2 → 3 → 4**.
Le fasi 5–7 sono incrementali.

---

## 6. Rischi e mitigazioni

| Rischio | Mitigazione |
|---|---|
| **Copertura del catalogo**: soulful house, broken beat, UK jazz sono spesso solo su Bandcamp/SoundCloud o su etichette piccole | Misurarla nella fase 0; override manuali; SoundCloud come provider; il brano senza sorgente resta sulla mappa con link "Apri su…" e il percorso lo salta |
| **Match sbagliati** (remix/edit diverso, video non ufficiale) | ISRC prima di tutto; soglia di confidenza; durata ±3 s; report "da verificare"; override che vincono sempre |
| **Servizi che chiudono o cambiano regole** (Odesli, Deezer, Spotify docet) | Tutto risolto offline e versionato nel repo; nessun provider è obbligatorio; fallback a catena |
| **ToS YouTube** (player visibile, niente audio separato, pubblicità) | Mostrare il video nel mini-player (area dedicata ≥200×200), niente trucchi audio-only; la modalità "Anteprime" resta disponibile per chi vuole solo audio |
| **Quota YouTube Data API** | Ricerca solo offline, incrementale, con cache; a runtime zero chiamate Data API |
| **Mobile in background** | YouTube si ferma a schermo spento: dichiararlo; `<audio>` (anteprime, Subsonic) supporta Media Session API |
| **Segreti** | Solo in CI/locale; Apple token pubblico per design ma vincolato all'origin; credenziali Subsonic solo nel browser dell'utente |
| **Regressioni sul flusso settimanale** | Fase 1 a grafo identico (diff dei nodi/archi in CI); `add_playlist.py` mantiene il formato attuale di `support.json` come caso "source: spotify" |

---

## 7. Da verificare nella fase 0 (non confermato dalla ricerca)

La rete del container di ricerca bloccava le chiamate dirette: questi punti
vanno provati da un browser reale o da GitHub Actions.

- Deezer: JSONP (`output=jsonp`) ancora funzionante? Durata di validità delle URL `preview`.
- iTunes Lookup API: JSONP/CORS da `marcomauro.github.io`; stabilità di `previewUrl`.
- MusicBrainz ws/2: header CORS (serve solo se mai lo si chiama dal browser — il piano non lo richiede).
- Spotify Dev Mode: `GET /tracks/{id}` con client credentials restituisce ancora `external_ids.isrc`?
- YouTube: percentuale di video ufficiali con embed disabilitato sul campione.
- Odesli: conferma della dismissione dell'API pubblica (il sito song.link come semplice link resta utile).
- Navidrome: `apiKey` OpenSubsonic presente in una release stabile.
- TIDAL: eventuale lancio del full playback per terze parti (oggi: solo anteprime).

---

## 8. Decisioni richieste prima di partire

1. **Provider "brano intero" per il pubblico**: YouTube (gratis, video visibile,
   pubblicità) — consigliato come default — e/o Apple Music (99 $/anno, solo abbonati)?
2. **Spotify Connect**: mantenerlo come opzione per l'owner (≤5 utenti) o rimuoverlo
   per semplificare? Consiglio: mantenerlo come provider, a costo zero dopo la fase 3.
3. **Licenza** di codice e dati.
4. **Template per altri curatori** (fase 7): obiettivo reale o solo "ascolto aperto"?
5. Soglia minima di copertura "riproducibile senza account" da imporre in CI (proposta: 95% anteprime).
