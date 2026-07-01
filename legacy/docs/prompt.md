Ciao Claude Code. Devo creare un nuovo progetto: una web app che visualizza una mappa force-directed interattiva del mio archivio musicale, da deployare su GitHub Pages.

Ho allegato 7 file. Il più importante è **`CLAUDE_CODE_BRIEFING.md`**: è un briefing completo e autosufficiente che descrive struttura, passi, configurazione e verifiche. Seguilo come guida principale.

Gli altri file sono:

- `MusicNetwork.jsx` — il componente React della mappa, già scritto e validato (da NON riscrivere, solo posizionare in `src/`)
- `build_graph.py`, `enrich_genres.py`, `genre_map.py` — gli script Python della pipeline dati (vanno in `scripts/`; nota che `enrich_genres.py` importa `genre_map.py`, devono stare insieme)
- `spotify_archive.json` — archivio grezzo, e `spotify_archive_genres.json` — archivio arricchito (entrambi in `data/`)

Cosa ti chiedo di fare:

1. Leggi per intero `CLAUDE_CODE_BRIEFING.md` prima di iniziare.
2. Crea lo scaffold Vite + React (non TypeScript) seguendo la struttura del briefing, posizionando i file allegati dove indicato.
3. Imposta `vite.config.js` con `base: '/new-release-atlas/'` (il repo si chiamerà `new-release-atlas`).
4. Genera `public/graph.json` eseguendo `build_graph.py` come da briefing (output atteso: 468 nodi, 3391 archi, 12 generi).
5. Crea il workflow GitHub Actions per il deploy automatico su Pages.
6. Scrivi il `README.md` documentando setup locale, pipeline dati a due stadi, workflow settimanale e gestione degli artisti nuovi.
7. Esegui tutte le verifiche finali della checklist del briefing: `npm install`, `npm run dev` (la mappa deve mostrarsi con nodi colorati, legenda-filtro, ricerca, dettaglio, zoom/pan/drag), e `npm run build` (con asset sotto il path `base` corretto).

Prima di lanciare comandi che modificano il sistema o installano pacchetti, fammi un riepilogo del piano. Procedi pure con la creazione dei file dello scaffold, ma fermati a chiedermi conferma prima del primo `git push` o di qualsiasi operazione su GitHub (creazione repo, deploy): quei passaggi li voglio supervisionare io.