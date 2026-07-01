# Legacy — pipeline classica e artefatti storici

Tutto ciò che sta in questa cartella è **fuori dal flusso vivo** della mappa.
Viene conservato come record storico e come fallback d'emergenza, ma **non
serve** per aggiungere nuove playlist (per quello vedi
[`docs/ADDING_PLAYLISTS.md`](../docs/ADDING_PLAYLISTS.md)).

## Perché è legacy

La mappa live è generata da `data/spotify_archive_enriched.json` (archivio
AI-arricchito, #1–#36 + extra, con mood/subgenres/bpm). La pipeline "classica"
qui sotto produceva gli archivi precedenti, **congelati a #12–#32 (471 tracce)**
e mai più rigenerati da quando l'arricchimento è passato al processo AI-expert.

## Contenuto

### `scripts/` — la pipeline classica a stadi

| Script | Cosa faceva | Stato |
|---|---|---|
| `genre_map.py` | mappa artista→generi (~529 artisti) + tassonomia; dipendenza di `enrich_genres` | congelato |
| `enrich_genres.py` | stadio 1: aggiunge `genres`/`genre_primary` per traccia (via `genre_map` + inferenza dai collaboratori) | congelato |
| `enrich_audio.py` | stadio 2: bpm/key/energy/year/popularity da ReccoBeats/Spotify/Deezer (locale, internet) | congelato |

Gli script restano **funzionanti** se eseguiti da questa cartella (importano
`genre_map` dalla stessa directory). I default `data/...` nei loro docstring si
riferiscono ai path storici: oggi i file sono in `legacy/data/`.

### `data/` — archivi congelati a #12–#32

| File | Contenuto |
|---|---|
| `spotify_archive.json` | archivio RAW (fonte di verità *dell'epoca*, 471 tracce, 21 playlist) |
| `spotify_archive_genres.json` | output di `enrich_genres.py` |
| `spotify_archive_features.json` | output di `enrich_audio.py` (year/popularity ≈97%, audio features ≈6%) |
| `genre_overrides.json` | override artista→generi per `enrich_genres.py` |

`build_graph.py` mantiene questi archivi come **fallback estremo** (se
l'enriched sparisse), con degradazione morbida dei campi mancanti.

### `docs/` — artefatti di bootstrap del progetto

| File | Cosa è |
|---|---|
| `prompt.md` | il prompt originale con cui è nato il progetto (record storico, non aggiornato) |
| `CLAUDE_CODE_BRIEFING.md` | il briefing di scaffolding iniziale (riallineato una volta ai dati reali, poi archiviato qui) |

## Se un giorno servisse riattivarla

La pipeline classica tornerebbe utile solo per **ri-generare da zero**
l'arricchimento senza il passaggio AI-expert (es. per riprodurre l'archivio da
un export grezzo). In quel caso: aggiornare i path, estendere `genre_map.py`
con gli artisti nuovi e accettare la perdita di mood/subgenres (che la pipeline
classica non produce).
