# Briefing per Claude Code — New Release Atlas (Vite + React, deploy GitHub Pages)

## Obiettivo
Creare da zero un progetto **Vite + React** che visualizza una mappa force-directed
interattiva di un archivio musicale (force graph con D3), pronta per il deploy su
**GitHub Pages**, con dati caricati **a runtime via `fetch`** da un file `graph.json`
separato (NON inline nel bundle).

Stesso pattern già usato per "B-Side Player": app statica, build Vite, deploy
automatico su GitHub Pages via GitHub Actions.

## Pipeline dati a due stadi (importante)
L'archivio attraversa due script Python prima di diventare la mappa:

```
spotify_archive.json                (archivio grezzo: tracce, artisti, playlist)
        │
        ▼  enrich_genres.py         ← aggiunge genres + genre_primary per traccia
spotify_archive_genres.json         (archivio arricchito)
        │
        ▼  build_graph.py           ← costruisce nodi + archi + cluster
public/graph.json                   (input della mappa, servito staticamente)
```

Nessuno dei due script usa le API di Spotify né richiede credenziali.

## File allegati a questo briefing
1. `spotify_archive_genres.json` — archivio GIÀ arricchito (stato attuale, pronto).
   Serve a far partire subito la mappa senza dover rieseguire l'arricchimento.
2. `MusicNetwork.jsx` — componente React della mappa, GIÀ scritto e validato.
   Carica i dati via `fetch(import.meta.env.BASE_URL + "graph.json")`. Usalo così
   com'è; non riscrivere la logica di visualizzazione.
3. `build_graph.py` — trasforma l'archivio arricchito in `graph.json`. Validato.
4. `enrich_genres.py` — aggiunge i generi all'archivio grezzo. Validato.
5. `genre_map.py` — modulo con la mappa artista→generi (541 artisti) e le funzioni
   di supporto. È una DIPENDENZA di `enrich_genres.py`: devono stare nella stessa
   cartella `scripts/`.
6. `spotify_archive.json` — archivio GREZZO (471 tracce, 21 playlist, #12–#32).
   È la fonte di verità mantenuta a mano: ogni settimana l'utente vi appende le
   nuove playlist (via Spotify MCP). Mettilo in `data/`. Da qui parte la pipeline
   di arricchimento. Verificato: la pipeline completa dal grezzo produce
   copertura 100% (535 artisti) → 468 nodi · 3391 archi · 12 generi.

## Struttura del progetto da creare
```
new-release-atlas/
├── .github/workflows/deploy.yml      # deploy automatico su GitHub Pages
├── data/
│   ├── spotify_archive.json          # archivio GREZZO (fonte di verità, mantenuto a mano)
│   ├── spotify_archive_genres.json   # archivio arricchito (input di build_graph)
│   └── genre_overrides.json          # (opzionale) artista→generi extra; vedi sotto
├── public/
│   └── graph.json                    # GENERATO da build_graph.py
├── scripts/
│   ├── genre_map.py                  # mappa + API (dipendenza di enrich_genres)
│   ├── enrich_genres.py              # stadio 1 del pipeline
│   └── build_graph.py                # stadio 2 del pipeline
├── src/
│   ├── MusicNetwork.jsx              # il componente allegato
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
└── README.md
```

## Passi da eseguire (in ordine)

### 1. Inizializza Vite (React, NON TypeScript)
- Dipendenze: `react`, `react-dom`, `d3`.
- Dev: `vite`, `@vitejs/plugin-react`.
- Vite ultima major stabile, React 18.

### 2. Posiziona i file allegati
- `MusicNetwork.jsx` → `src/MusicNetwork.jsx`
- `genre_map.py`, `enrich_genres.py`, `build_graph.py` → `scripts/`
- `spotify_archive_genres.json` → `data/`
- `spotify_archive.json` (grezzo) → `data/`

### 3. Genera `public/graph.json`
```bash
python3 scripts/build_graph.py --input data/spotify_archive_genres.json --output public/graph.json
```
Output atteso: `468 nodi · 3391 archi · 12 generi`.

### 4. `vite.config.js` — CRITICO per GitHub Pages
GitHub Pages serve i project site da `/<nome-repo>/`. Imposta `base`:
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/new-release-atlas/',   // = nome esatto del repository GitHub
})
```
Se il repo avrà un nome diverso, aggiorna `base`. Senza questo, in produzione la
pagina resta bianca (asset non trovati). Il componente usa `import.meta.env.BASE_URL`
proprio per leggere `graph.json` dal path corretto sia in dev che in produzione.

### 5. `src/App.jsx` e `src/main.jsx`
- `App.jsx`: importa e renderizza `<MusicNetwork />` a tutto schermo.
- `main.jsx`: monta con `ReactDOM.createRoot`.
- Stili globali minimi: `html,body{margin:0;height:100%}`, `#root{height:100vh}`.

### 6. `index.html`
- Titolo "New Release Atlas".
- Font Google: `Spectral` (ital, 300/500) e `Inter` (400/500/600) — il componente li usa.
- `<div id="root"></div>` + script su `src/main.jsx`.

### 7. GitHub Actions — `.github/workflows/deploy.yml`
Workflow che, ad ogni push su `main`:
1. checkout;
2. setup Python 3 → `python scripts/build_graph.py` (rigenera `public/graph.json`
   in CI: garantisce coerenza anche se ci si dimentica di rigenerarlo in locale);
3. setup Node → `npm ci` → `npm run build`;
4. pubblica `dist/` su Pages con `actions/upload-pages-artifact` + `actions/deploy-pages`.
Permessi `pages: write`, `id-token: write`; environment `github-pages`; concurrency standard.

### 8. `.gitignore`
Standard Node/Vite: `node_modules/`, `dist/`, `.DS_Store`, cache.
NON ignorare `public/graph.json`, `data/`, `scripts/`.

### 9. `README.md`
Documenta tutto (vedi sezioni sotto): setup locale, pipeline dati a due stadi,
workflow settimanale, gestione artisti nuovi/sconosciuti, nota su `base`.

## Setup locale (da mettere nel README)
```bash
npm install
python3 scripts/build_graph.py --input data/spotify_archive_genres.json --output public/graph.json
npm run dev
```
La mappa funziona SOLO via dev server o build servita: usa `fetch` su `graph.json`,
quindi aprire il file buildato con doppio click NON funziona (policy CORS sui file
locali). In produzione su Pages il fetch funziona sempre.

## Workflow settimanale (da mettere nel README)
Quando arriva una nuova New Release Playlist:

```bash
# 1. aggiorna l'archivio GREZZO con le nuove tracce (data/spotify_archive.json)
#    (export dal tuo sistema di curation)

# 2. arricchisci con i generi
python3 scripts/enrich_genres.py \
    --input data/spotify_archive.json \
    --output data/spotify_archive_genres.json \
    --overrides data/genre_overrides.json \
    --report-missing data/missing_artists.json

# 3. se lo script segnala artisti non classificati, aggiungili a
#    data/genre_overrides.json  (formato: {"Nome Artista": ["genere1","genere2"]})
#    e ri-esegui lo step 2. I generi validi sono in genre_map.TAXONOMY.

# 4. rigenera il grafo
python3 scripts/build_graph.py \
    --input data/spotify_archive_genres.json \
    --output public/graph.json

# 5. commit + push -> GitHub Actions ripubblica da solo
git add -A && git commit -m "update: New Release #NN" && git push
```

## Gestione artisti nuovi/sconosciuti (da documentare nel README)
- `enrich_genres.py` classifica gli artisti tramite `genre_map.py`. Per gli artisti
  sconosciuti tenta un'inferenza dal contesto (eredita i generi dei co-autori noti
  sulla stessa traccia). Se non c'è alcun appiglio, l'artista resta `unknown` e
  viene SEGNALATO a fine esecuzione.
- Due modi per classificare un artista nuovo:
  - **rapido**: aggiungilo a `data/genre_overrides.json` (non tocca il codice);
  - **permanente**: aggiungilo al dizionario `GENRES` in `scripts/genre_map.py`.
- `--report-missing` scrive un JSON con, per ogni artista mancante, il numero di
  tracce e i collaboratori noti — utile per classificarlo correttamente.
- `--fail-on-missing N` fa uscire lo script con errore se i mancanti superano N:
  utile in CI per essere avvisati quando una playlist introduce artisti nuovi.

## Tassonomia generi (valori ammessi negli overrides)
`soulful-house, broken-beat, uk-jazz, jazz, neo-soul, soul-funk, hip-hop,
electronic, downtempo, world, alt, classical`
(`unknown` è il fallback, da evitare negli overrides).

## Verifiche finali prima di considerare il task completo
- [ ] `npm install` senza errori.
- [ ] `python3 scripts/build_graph.py ...` stampa `468 nodi · 3391 archi · 12 generi`.
- [ ] `npm run dev` mostra la mappa: nodi colorati per genere, legenda-filtro a
      sinistra, ricerca, pannello di dettaglio al click, zoom/pan/drag.
- [ ] In console `graph.json` viene caricato (468 nodi).
- [ ] La legenda NON intercetta i click sui nodi sottostanti (il componente lo
      gestisce via `pointer-events`; verifica dopo il build).
- [ ] `npm run build` produce `dist/` senza errori; `dist/index.html` referenzia
      gli asset sotto il path `base` corretto (es. `/new-release-atlas/assets/...`).
- [ ] (Opzionale) Testa il pipeline di arricchimento: con un `spotify_archive.json`
      grezzo, `enrich_genres.py` deve stampare la copertura % e segnalare eventuali
      mancanti.

## Note sul componente (contesto, non da modificare)
- Nodi = brani; archi = artista condiviso (forte) + genere primario condiviso (medio)
  + genere secondario condiviso (leggero) + stessa playlist (debole).
- Colore = `genre` primario; una forza radiale separa i generi nello spazio.
- Stato attuale: 468 brani unici, 3391 archi, 12 generi (playlist #12–#32).
- Il default export fa il `fetch` di `graph.json`, mostra un loader, poi monta la
  mappa. Nessuna prop da passare. Unico punto da toccare se cambi il path del JSON.
