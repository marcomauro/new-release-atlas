# Ottimizzazione del grafo e dell'interazione — backlog

> Traccia unica dei punti di ottimizzazione individuati per la mappa (grafo D3)
> e per l'interazione dell'utente con essa. Ricostruita il 2026-10-20 dalle
> analisi delle sessioni di giugno–luglio 2026 e dalle PR che ne sono nate,
> verificata sul codice di `main`. Da aggiornare a ogni intervento: **una riga
> per punto, con stato e PR**.

Legenda: ✅ fatto · 🟡 parziale · ⏳ aperto · 🔬 prototipo in valutazione · ⛔ superato

## Punti aperti (in ordine di priorità suggerita)

| # | Punto | Origine | Stato |
|---|---|---|---|
| 1 | **Zoom-to-fit iniziale** di tutta la mappa (e Reset che torna alla vista inquadrata) | Distribuzione cluster, Fase 4 (19/06) | ✅ PR #107 — vedi [sotto](#1-zoom-to-fit-iniziale) |
| 2 | **Meno archi per lo stesso artista** (clique → anello con corde) | Clique d'artista, Fase 2 (12/07) | ✅ PR #107, **solo disegno + forze**: i percorsi delle playlist non cambiano — vedi [sotto](#2-meno-archi-per-lo-stesso-artista) |
| 3 | **Rendering canvas** al posto di SVG | Piano 01/07, Fase 5 | ✅ PR #107, dopo la prova A/B sul telefono — vedi [sotto](#3-rendering-canvas) |
| 4 | Generazione playlist su **frontiera di candidati** (`buildFromSeed`/`buildPlaylist` da O(N×size) a O(vicini)) | Piano 01/07, Fase 5/D | ⏳ rinviato — riguarda l'algoritmo, non il disegno |
| 5 | **Mappa più grande su telefono**: cluster disposti in verticale, `charge` e scala delle ancore dedicati al mobile | Distribuzione cluster, Fase 4 (19/06) | ⏳ in attesa — la vista attuale va bene per ora (2026-10-20); dettagli [sotto](#mappa-più-grande-su-telefono-in-attesa) |
| 6 | Attrazione d'autore via **distanza di link ×1.3** e `artistCohesion` ~0.05 | Distribuzione cluster, Fase 3 (19/06) | 🟡 risolto in gran parte da PR #89 con un altro approccio; i parametri proposti non sono mai stati applicati |
| 7 | **Hook di stato** estratte da `MusicNetwork.jsx` (è risalito a ~1.100 righe) | Piano 01/07, Fase 3/A | 🟡 split fatto (PR #76) senza hook |
| 8 | Bozza automatica di `char.json` | Piano 01/07, Fase 4/G | ⏳ rinviato — flusso dati, fuori dal perimetro grafico |
| 9 | `metadata.history[]` al posto delle chiavi ad-hoc (`extended_at_35`, `renumber_note_extra1`, …) | Piano 01/07, Fase 4/F | ⏳ rinviato — flusso dati |
| 10 | Ricalibrazione dei pesi dell'algoritmo; codifica visiva mood/bpm o filtro per mood | Proposta di inizio giugno (non scelta) | ⏳ nota solo da un riassunto: testo originale non recuperato |
| 11 | **Hover a due tempi** su desktop: nome subito, vicini e legami dopo ~0,5 s fermi sul pallino | Richiesta 20/10 | ✅ PR in arrivo — vedi [sotto](#hover-a-due-tempi) |

## Possibili modifiche in attesa

### Mappa più grande su telefono (in attesa)

Su un telefono (390×844) lo schermo è alto e stretto, ma la mappa uscita
dalla simulazione è più larga che alta: circa 806×1013 unità di grafo contro
un'area libera di 370×660 px. Lo zoom-to-fit iniziale deve quindi regolarsi
sulla larghezza (zoom ≈ 0,45): la mappa occupa ~363×458 px, restano ~200 px
vuoti sopra e sotto e i pallini hanno raggio di soli 1,4–3,6 px a schermo.

Proposta, **solo su mobile** e solo layout (dati e playlist invariati):

- in `packGenreAnchors` (`src/graph/layout.js`) alzare il limite di
  deformazione tra gli assi (`RATIO`, oggi 1,7) per i viewport verticali,
  così i territori dei generi si dispongono in una colonna più alta;
- valutare `charge` un po' meno negativa e ancore più forti su mobile, per
  cluster più compatti.

Obiettivo: forma della mappa vicina a quella dello schermo → zoom iniziale
~0,6, pallini ~30% più grandi, sempre 0 nodi fuori schermo. Da misurare con
prima/dopo e screenshot del telefono. Stato: l'utente ha confermato che la
vista attuale sul telefono va bene per ora (2026-10-20).

## Interventi recenti

### 1. Zoom-to-fit iniziale

**Problema misurato** (layout assestato, prima dell'intervento): su mobile
(390×844) **481 nodi su 1.022 fuori schermo**; su desktop (1440×900) 67, con i
cluster sotto titolo e legenda.

**Soluzione** (`src/MusicNetwork.jsx`, `fitTransform` in `src/graph/layout.js`):

- mentre il primo layout si assesta la camera **lo segue** (a ogni tick si
  avvicina del 12% all'inquadratura ideale), poi atterra sull'inquadratura
  esatta: nessun salto visibile a fine assestamento;
- l'area utile esclude la colonna titolo/legenda (desktop) o l'header impilato
  (mobile) e la pillola *Playlist*;
- qualsiasi gesto (rotella, pan, pinch, drag di un nodo), un percorso o una
  selezione restituiscono la camera all'utente;
- **Reset** torna alla vista inquadrata (prima: zoom identità); dopo un resize
  la mappa si re-inquadra solo se l'utente non ha mosso la camera;
- l'inquadratura del percorso usa la stessa funzione (comportamento identico).

**Risultato**: 0 nodi fuori schermo su desktop e mobile.

### 2. Meno archi per lo stesso artista

Gli archi d'artista sono una **clique completa** per artista (Louie Vega, 22
brani: 231 archi). Sopra i 5 brani la clique è sostituita, **solo per il
disegno e per la forza dei link**, da un anello con corde: ogni brano è
collegato ai 2 successivi in ordine di uscita (prima playlist). Il gruppo resta
connesso e coeso; si tolgono solo archi **puramente** d'artista (nessun genere
o playlist in comune).

- Linee disegnate: **9.362 → 8.172** (−1.190, −13%; −39% degli archi d'artista).
- **Percorsi delle playlist invariati**: `graph.json`, `GRAPH.links` e i gradi
  dei nodi non cambiano; `buildFromSeed`/`buildPlaylist` leggono il grafo
  completo. Lo verifica `tests/graph_layout.test.mjs` (stesso seed → stesso
  percorso, dati non mutati).
- **Interazione invariata**: hover e selezione mostrano ancora *tutte* le
  connessioni reali — gli archi assottigliati del nodo a fuoco sono disegnati in
  un livello dedicato (`.mn-focuslinkg`, costo O(grado)). Esempio: *Winter in
  America* (Brian Jackson / Louie Vega) → 37 vicini, 17 archi di base + 20 nel
  livello di focus.
- Coesione dei gruppi (raggio RMS in unità di grafo): variazione +7–9% per i
  gruppi grandi, entro la variabilità del layout (+20% anche sul gruppo di
  controllo Ibeyi, 3 brani, che non è toccato).

La variante "in `build_graph.py`" (sparsificare i dati) è stata **scartata**:
cambierebbe adiacenza e gradi, quindi i percorsi delle playlist.

### 3. Rendering canvas

**Simulazione** (2026-10-20): prototipo A/B fuori dall'app, con stessi dati,
stesse forze e stesso disegno, il motore SVG o canvas da un interruttore e due
misure integrate (fps durante uno zoom animato e durante il layout). Provato
sul telefono: il canvas è risultato **nettamente più fluido**, quindi è stato
integrato.

**Integrazione** (`src/graph/canvasMap.js`): un solo `<canvas>` disegna archi,
livello di focus, percorso, nodi ed etichette, al massimo una volta per frame.
`MusicNetwork.jsx` calcola lo stato (cosa è acceso, spento, selezionato, in
riproduzione) e lo passa al canvas; il canvas lo dipinge e risponde a "quale
nodo è sotto il puntatore?" per hover, clic, tap e drag. Comportamenti
invariati: hover con vicini e archi, selezione con alone, percorso sfumato con
bagliore, etichette a dimensione controllata con alone e posizionamento
anti-sovrapposizione, nodi spenti non cliccabili, drag dei nodi, zoom/pan.
Il canvas disegna ogni linea separatamente, come SVG, perché le
sovrapposizioni dei legami restino visibili.

Misure nell'app, stessa build prima (SVG) e dopo (canvas), in un browser
**senza GPU** (container headless: valori assoluti bassi, conta il rapporto):

| fps (p95 ms per frame) | SVG | Canvas |
|---|---|---|
| Assestamento iniziale, desktop 1440×900 | 5,7 (250) | 16,6 (83) |
| Zoom con la rotella, desktop | 6,7 (217) | 14,1 (100) |
| Hover lungo la mappa, desktop | 7,4 (167) | 33,1 (67) |
| Assestamento iniziale, telefono 390×844 DPR 2 | 6,7 (233) | 16,2 (83) |
| Zoom, telefono | 7,5 (200) | 16,3 (100) |

Il lavoro JS per frame durante il layout scende da ~23 ms a ~1 ms: prima ogni
tick riscriveva gli attributi di ~10.000 elementi SVG.

### Hover a due tempi

Su desktop, passando sopra un pallino si accendeva subito tutto il vicinato
(nome, vicini con le etichette, legami) e il resto della mappa si spegneva:
muovendo il mouse sulla mappa lampeggiava di continuo. Ora:

- **subito**: bordo scuro ed etichetta del brano, più il riquadro con titolo e
  artista; la mappa resta com'è (hover "leggero" in `canvasMap.js`);
- **dopo 450 ms fermi** sul pallino (`HOVER_LINKS_DELAY` in
  `MusicNetwork.jsx`): vicini, etichette e legami, con il resto che sfuma,
  come prima;
- il clic resta immediato; su touch l'hover non c'è.

## Storico: già fatto

| Analisi | Punti | PR |
|---|---|---|
| Impacchettamento esagonale nei cluster d'autore (19/06) | coesione 0.5→0.15, jitter sul raggio di collisione | #58, #59 |
| Distribuzione visiva della mappa (19/06) | ancore impacchettate ∝ √brani (F1); separazione tra cluster (F2); calibrazione mobile raggi/collisione (F4, parziale) | #60–#69 |
| Piano del 01/07 — Fase 1 solidità | `check_archive.py`, test della pipeline in CI | #75 |
| Piano del 01/07 — Fase 2 performance | hover O(grado) con classi CSS, niente hover su touch; `graph.json` formato 2 (−37%) | #75 |
| Piano del 01/07 — Fase 3 manutenibilità | split di `MusicNetwork.jsx` in moduli | #76 |
| Etichette in modalità percorso (04/07) | dimensione costante a schermo (10 px), alone, titolo + artista | #82, #83 |
| Leggibilità del percorso (05/07) | 11 px, posizionamento anti-sovrapposizione (10 candidati), spazio extra attorno ai nodi | #85 |
| Etichette mobile e selezione (05/07) | 11 px × k^0.4 limitato a [8,16] px; la selezione riceve il trattamento del percorso | #86, #87 |
| Clique d'artista (12/07) — Fase 1 | forze normalizzate per grado di clique, coesione adattiva | #89 |
| Atlante circle-packing e prime tarature (06–10/06) | strategia label, etichette a domanda, tarature di forze | ⛔ #10, #11, #27–#29 superati da #12 e #30 |
