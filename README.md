# New Release Atlas

Mappa **force-directed** interattiva del mio archivio musicale (New Release
Playlist). Ogni nodo è un brano; gli archi collegano brani che condividono un
artista, un genere o una playlist. Il colore del nodo è il **genere primario
inferito**; una forza radiale separa i generi nello spazio, formando cluster.

App statica: **Vite + React + D3**, deploy automatico su **GitHub Pages**.
I dati sono caricati **a runtime** via `fetch` da `graph.json` (non sono inline
nel bundle).

Stato attuale: **468 brani · 3391 archi · 12 generi** (playlist #12–#32).

---

## Stack

- **Vite** (build, dev server) + **React 18** (no TypeScript)
- **D3** per la simulazione force-directed e lo zoom/pan
- **GitHub Actions** per build + deploy su Pages

---

## Setup locale

```bash
npm install
python3 scripts/build_graph.py --input data/spotify_archive_genres.json --output public/graph.json
npm run dev
```

Apri l'URL che stampa Vite (es. `http://localhost:5173/new-release-atlas/`).

> **Importante:** la mappa carica `graph.json` via `fetch`, quindi funziona
> **solo** servita da un server (dev server o `npm run preview`, oppure Pages in
> produzione). Aprire il file buildato con doppio click **non** funziona per via
> della policy CORS sui file locali.

### Build di produzione

```bash
npm run build      # genera dist/
npm run preview    # serve dist/ in locale per una verifica realistica
```

---

## Pipeline dati a due stadi

L'archivio attraversa due script Python prima di diventare la mappa. **Nessuno
dei due usa le API di Spotify né richiede credenziali.**

```
data/spotify_archive.json              (archivio GREZZO: tracce, artisti, playlist — fonte di verità, mantenuto a mano)
        │
        ▼  scripts/enrich_genres.py     ← aggiunge genres + genre_primary per traccia
data/spotify_archive_genres.json        (archivio ARRICCHITO)
        │
        ▼  scripts/build_graph.py       ← costruisce nodi + archi + cluster (idempotente)
public/graph.json                       (input della mappa, servito staticamente)
```

- **`scripts/genre_map.py`** — mappa artista→generi (541 artisti) + funzioni di
  supporto. È una **dipendenza** di `enrich_genres.py`: devono stare nella stessa
  cartella `scripts/`.
- **`scripts/enrich_genres.py`** — stadio 1: classifica ogni traccia per genere.
- **`scripts/build_graph.py`** — stadio 2: costruisce il grafo. È idempotente,
  rigenera l'intero grafo dallo stato corrente dell'archivio.

### Come si costruiscono gli archi

- **artista condiviso** → legame forte
- **genere primario condiviso** → legame medio (kNN sparso)
- **genere secondario condiviso** → legame leggero
- **stessa playlist** → legame debole

---

## Workflow settimanale

Quando arriva una nuova New Release Playlist:

```bash
# 1. Aggiorna l'archivio GREZZO con le nuove tracce (data/spotify_archive.json),
#    esportando dal tuo sistema di curation.

# 2. Arricchisci con i generi
python3 scripts/enrich_genres.py \
    --input data/spotify_archive.json \
    --output data/spotify_archive_genres.json \
    --overrides data/genre_overrides.json \
    --report-missing data/missing_artists.json

# 3. Se lo script segnala artisti non classificati, aggiungili a
#    data/genre_overrides.json e ri-esegui lo step 2 (vedi sotto).

# 4. Rigenera il grafo
python3 scripts/build_graph.py \
    --input data/spotify_archive_genres.json \
    --output public/graph.json

# 5. Commit + push → GitHub Actions ripubblica da solo
git add -A && git commit -m "update: New Release #NN" && git push
```

> Il workflow CI rigenera comunque `graph.json` dall'archivio arricchito a ogni
> push, quindi anche se dimentichi lo step 4 la pubblicazione resta coerente.

---

## Gestione degli artisti nuovi / sconosciuti

`enrich_genres.py` classifica gli artisti tramite `genre_map.py`. Per gli
artisti sconosciuti tenta un'**inferenza dal contesto**: se un artista
collabora, sulla stessa traccia, con artisti noti, eredita i loro generi (peso
ridotto). Se non c'è alcun appiglio, l'artista resta `unknown` e viene
**segnalato** a fine esecuzione.

Due modi per classificare un artista nuovo:

- **rapido** — aggiungilo a `data/genre_overrides.json` (non tocca il codice):

  ```json
  {
    "Nome Artista": ["genere1", "genere2"],
    "Altro Artista": ["jazz"]
  }
  ```

- **permanente** — aggiungilo al dizionario `GENRES` in `scripts/genre_map.py`.

Opzioni utili di `enrich_genres.py`:

- `--report-missing data/missing_artists.json` — scrive, per ogni artista
  rimasto `unknown`, il numero di tracce e i collaboratori noti: utile per
  classificarlo correttamente.
- `--fail-on-missing N` — esce con errore se i mancanti superano `N`. Utile in
  CI per essere avvisati quando una playlist introduce artisti nuovi.

### Tassonomia generi (valori ammessi negli overrides)

```
soulful-house · broken-beat · uk-jazz · jazz · neo-soul · soul-funk
hip-hop · electronic · downtempo · world · alt · classical
```

(`unknown` è il fallback, da evitare negli overrides.)

---

## Deploy su GitHub Pages

Il deploy è automatico: ad ogni push su `main`, il workflow in
`.github/workflows/deploy.yml`:

1. fa il checkout;
2. installa Python e rigenera `public/graph.json` (`build_graph.py`);
3. installa Node, esegue `npm ci` e `npm run build`;
4. pubblica `dist/` su Pages.

### Nota su `base` (critica)

GitHub Pages serve i project site da `/<nome-repo>/`. In
[`vite.config.js`](vite.config.js) il campo `base` **deve** coincidere col nome
esatto del repository:

```js
base: '/new-release-atlas/',
```

Se il repo viene rinominato, aggiorna `base` di conseguenza — altrimenti in
produzione gli asset non vengono trovati e la pagina resta bianca. Il componente
usa `import.meta.env.BASE_URL` proprio per leggere `graph.json` dal path
corretto sia in dev sia in produzione.

---

## Struttura del progetto

```
new-release-atlas/
├── .github/workflows/deploy.yml      # deploy automatico su GitHub Pages
├── data/
│   ├── spotify_archive.json          # archivio GREZZO (fonte di verità)
│   ├── spotify_archive_genres.json   # archivio arricchito (input di build_graph)
│   └── genre_overrides.json          # (opzionale) artista→generi extra
├── public/
│   └── graph.json                    # GENERATO da build_graph.py
├── scripts/
│   ├── genre_map.py                  # mappa + API (dipendenza di enrich_genres)
│   ├── enrich_genres.py              # stadio 1 della pipeline
│   └── build_graph.py                # stadio 2 della pipeline
├── src/
│   ├── MusicNetwork.jsx              # componente della mappa (D3 force graph)
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.js
└── README.md
```
