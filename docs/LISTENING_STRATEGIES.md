# Strategie per far ascoltare tutti

> Stato: **proposta** · Ricerca: 2026-10-17 · Ramo `experimental/platform-independence`
> Complementare a [`PLATFORM_INDEPENDENCE_PLAN.md`](PLATFORM_INDEPENDENCE_PLAN.md).

Domanda: oltre al player YouTube già sul ramo, **quali strade permettono a
chiunque di ascoltare i brani della mappa**, legalmente, senza account a
pagamento e senza un backend?

Vincoli fissati: app statica (GitHub Pages), progetto personale non
commerciale gestito dall'Italia, **niente Apple** (MusicKit scartato),
**YouTube resta la base**.

La ricerca non ha potuto chiamare direttamente le API (rete del container
bloccata): i fatti vengono da documentazione, codice sorgente e fonti
secondarie. Ciò che va provato a mano è marcato **⚠︎ da verificare** ed
elencato in §7.

---

## 1. Il punto di partenza: cosa copre YouTube e cosa no

YouTube dà **brani interi gratis a tutti**, ed è l'unica sorgente on-demand
di questo tipo. Restano quattro buchi:

1. **Copertura**: brani non presenti o con embed disabilitato (errori 101/150) —
   probabilmente più frequenti proprio nei generi di nicchia dell'archivio.
2. **Mobile in background**: da inizio 2026 YouTube blocca la riproduzione in
   background nei browser mobile per chi non ha Premium (⚠︎ fonte giornalistica).
   A schermo spento la musica si ferma.
3. **Una sola piattaforma**: se YouTube cambia regole, l'ascolto si ferma.
4. **Chi preferisce la propria app** (Deezer, TIDAL, SoundCloud, Spotify…) oggi
   non ha un modo semplice per portarci il percorso.

Le strategie si dividono in quattro famiglie, una per buco.

---

## 2. Famiglia A — Sorgenti complementari dentro l'app

Altre sorgenti che il browser può riprodurre senza backend, da mettere **in
catena dopo YouTube** (stessa `playbackRoute.js`, stesso switch di sorgente).

| Sorgente | Brano | Account per chi ascolta | Costo per noi | Avanza da sola nel percorso? | Copertura per questi generi | Note |
|---|---|---|---|---|---|---|
| **SoundCloud** (Widget API) | intero se caricamento libero; **30 s** se è un brano Go+ | no | gratis (l'API di ricerca richiede Artist Pro, ~99 $/anno: evitabile) | **sì** (evento `FINISH`, `load()` nello stesso iframe) | **buona** per broken beat, UK jazz, soulful house, downtempo, hip-hop (account di etichette/artisti) | attribuzione obbligatoria; i ToS vietano di creare "un nuovo servizio di streaming" — una mappa curata è difendibile ma è una valutazione |
| **Audius** (API pubblica) | **intero** | no | gratis (chiave gratuita) | **sì** (`<audio>` nativo: tutti gli eventi, anche background ⚠︎) | **bassa** (<5% stimato: molto self-release elettronico/hip-hop) | economico da aggiungere come extra opportunistico |
| **Bandcamp** (embed) | intero (salvo limite "3 ascolti" ⚠︎ sugli embed) | no | gratis | **no**: nessuna API JS né eventi → il brano si carica, l'ascoltatore preme play | **molto alta** per le etichette indipendenti dell'archivio | id da trovare a build time (MusicBrainz url-rels o pagina del brano); niente ricerca ufficiale |
| **Deezer** (API pubblica) | **30 s** | no | gratis, senza chiave | **sì** (`<audio>`) | **ampia** (anche major), match **per ISRC** | le URL di anteprima scadono (~15–30 min): salvare l'id Deezer e chiedere l'anteprima al momento; niente CORS, JSONP ⚠︎ |
| Mixcloud | solo **mix/show** >15 min | no | gratis | sì (widget API) | — | non è una sorgente per singolo brano: vedi Famiglia D (radio) |
| Traxsource, Beatport | anteprime ~2 min | no | — | no API pubblica | ottima per soulful house | solo come link "ascolta/compra"; usare le loro mp3 direttamente viola i ToS |
| Esclusi | | | | | | iTunes (Apple, e ToS "non per intrattenimento"), Juno Download (chiuso giu. 2026), Jamendo/FMA (catalogo CC, nessuna sovrapposizione), hearthis.at/Audiomack (API chiuse o deboli), TIDAL embed (30 s senza eventi) |

**Catena di fallback proposta** (per ogni brano, la prima sorgente disponibile):

```
YouTube (intero) → SoundCloud (intero; se Go+ → segnato "anteprima")
→ Audius (intero, dove c'è) → Deezer (anteprima 30 s)
→ Bandcamp (intero ma con play manuale: il percorso si mette in pausa lì)
→ link "Apri/Compra su…" (Traxsource, Beatport, Bandcamp)
```

Il percorso avanza da solo solo attraverso sorgenti con eventi (YouTube,
SoundCloud, Audius, Deezer); un brano solo-Bandcamp ferma la sequenza finché
l'ascoltatore non agisce.

**Prerequisito comune: l'ISRC.** Deezer si interroga per ISRC; MusicBrainz per
ISRC restituisce anche i link Bandcamp/SoundCloud noti (`inc=url-rels`) e l'MBID
che serve a ListenBrainz (Famiglia B). Si ottiene da Spotify (`GET /tracks/{id}`,
1 chiamata a brano, ~20 min per l'archivio) con il **client secret** dell'app
Spotify esistente. È la fase 1 del piano generale, e sblocca quasi tutto il resto.

---

## 3. Famiglia B — Consegnare il percorso all'app di chi ascolta

Invece di (o oltre a) suonare nella pagina, si dà all'ascoltatore il percorso
**dentro l'app che usa già**: brani interi, nessun limite di embed, background
compreso per chi ha un abbonamento.

| Strategia | Per chi | Sforzo | Rischi |
|---|---|---|---|
| **"Apri su YouTube"**: il percorso diventa una playlist temporanea anonima `youtube.com/watch_videos?video_ids=a,b,c` (spezzata in blocchi da 50) | tutti, nessun login; chi ha Premium ascolta anche a schermo spento | **S** | endpoint non documentato (usato da NewPipe dal 2025): può sparire; playlist senza titolo che scade dopo qualche giorno; apertura in YouTube Music ⚠︎ |
| **Menu "Apri nella mia app" per brano**: Spotify (`open.spotify.com/track/…`, apre l'app su mobile), YouTube / YouTube Music (dal videoId), Deezer/SoundCloud/Bandcamp dagli id risolti, altrimenti pagina song.link o URL di ricerca | chi usa un servizio preciso | **S** | formati degli URL di ricerca ⚠︎ da provare sui dispositivi |
| **Export del percorso come file**: TXT "Artista – Titolo", CSV (con ISRC e link), JSPF, XSPF + mini-guida per importarlo in TuneMyMusic (gratis fino a 500 brani) o Soundiiz (gratis fino a 200 per trasferimento) | Deezer, TIDAL, Amazon, qualsiasi altro servizio | **S** | passaggio manuale; nessun servizio di trasferimento offre un'API "un clic" |
| **Export via ListenBrainz** (`POST /1/playlist/export-jspf/{spotify\|apple_music\|soundcloud}`, CORS aperto, verificato nel codice) | chi ha Spotify, Apple Music o SoundCloud, **senza** che noi paghiamo Apple | **M** | serve l'**MBID** di ogni brano (quelli senza vengono scartati in silenzio); l'utente deve creare un account ListenBrainz e incollare il suo token; servizio volontario |
| Da **non** fare | | | creare playlist con la YouTube Data API (50 unità a inserimento: ~3 percorsi al giorno per *tutti* gli utenti; app OAuth non verificata limitata a 100 utenti a vita); "salva su Spotify" per il pubblico (limite 5 utenti); smart-link a pagamento (Linkfire, Feature.fm: solo per playlist già esistenti) |

---

## 4. Famiglia C — Far arrivare l'app alle persone

| Strategia | Sforzo | Note |
|---|---|---|
| **Percorsi condivisibili**: `?r=v1.<indici compatti>` (~50 caratteri per 30 brani) + **QR code** generato nel browser | **S** | serve una tabella di indici *solo in append* (mai riordinata) perché i vecchi link restino validi. Le anteprime social (Open Graph) restano generiche: senza server non si personalizzano, salvo pagine statiche pre-generate per i percorsi "curati" |
| **Embed per blog**: `embed.html?r=…` + snippet iframe da copiare | **S–M** | il player YouTube dentro l'iframe deve restare visibile e intatto; niente oEmbed (serve un endpoint) |
| **Play Store come TWA** (Bubblewrap/PWABuilder, 25 $ una tantum) | **M** | poco guadagno rispetto all'installazione PWA già presente; Google rifiuta app YouTube che suonano in background; account personali nuovi: 12 tester per 14 giorni; `assetlinks.json` deve stare alla radice del dominio (su `*.github.io` serve il repo utente o un dominio proprio). iOS escluso (Apple) |

---

## 5. Famiglia D — Licenze e audio ospitato da noi

Le uniche strade per **non dipendere da embed di terzi**. Sintesi onesta:
**nessuna licenza accessibile a un privato permette lo streaming on-demand di
questo catalogo nel mondo.** Esistono tre vie legali, tutte con compromessi.

| Via | Chi ascolta | On-demand? | Costo/anno | Sforzo | Rischio legale | Adatta all'app? |
|---|---|---|---|---|---|---|
| **Modalità Radio su Mixcloud**: percorsi da ~1 ora caricati come "show" (Mixcloud ha licenze con collecting, major e Merlin); la mappa segue lo show via widget API (`progress`) | quasi tutto il mondo (alcuni blocchi per paese ⚠︎) | **no**: flusso lineare, regole sugli artisti (max 4 brani per artista, 3 per release per show) | 0 € | **M** (montare i mix, rispettare le regole) | basso se si rispettano le regole | **buona**: "ascolta il percorso come una radio" con la mappa che si illumina |
| **Webradio italiana** SIAE (amatoriale, ~400 € ⚠︎) + SCF (amatoriale 2026: 463,40 € + IVA) con AzuraCast/Icecast | **solo Italia** (licenze territoriali) | no: solo flusso continuo | **≈1.000 €** + server | M (report annuali) | basso in Italia; gli ascoltatori esteri non sono coperti | discreta (AzuraCast ha API "now playing"), ma non è "per tutti". Attenzione: link commerciali nell'app possono far perdere lo status amatoriale |
| **Permessi diretti** di artisti/etichette indipendenti + file su Cloudflare R2/Backblaze B2 (pochi €) | tutti, nel mondo (se il permesso lo dice) | **sì** | ~0–5 € | **alto, brano per brano** | basso–medio: il permesso deve coprire **master e edizioni** (o una licenza non commerciale ex dir. 2014/26/UE art. 5(3)) | **eccellente** ma solo per i brani concessi; ottimo per le piccole etichette della scena |
| Live365 (licenze incluse) | solo USA/Canada/Messico (+ UK a pagamento) | no | ~780 $ | basso | — | poco: non copre Italia/UE |
| On-demand vero (accordi con major ed edizioni) | — | sì | minimi da migliaia di €/anno + accordi diretti | altissimo | — | non realistico |
| **Da non fare** | | | | | | anteprime da 30–90 s ospitate da noi senza permesso (in Italia non c'è fair use; l'art. 70 LDA non copre questo uso); musica su GitHub Releases o Internet Archive |

Per i **permessi diretti** il documento da far firmare (anche via email) deve
indicare: brani (con ISRC), garanzia che chi firma controlla master **e**
composizione, solo streaming (o anche download), brano intero o anteprima,
territorio mondiale, uso non commerciale senza pubblicità, crediti e link
d'acquisto, revocabile in qualsiasi momento con rimozione entro un termine
(es. 72 ore). I promo pool (Inflyte e simili) **non** sono una via: vietano la
redistribuzione pubblica.

---

## 6. Roadmap proposta

Ordinata per rapporto beneficio/sforzo. Ogni ondata è indipendente.

**Ondata 1 — subito, gratis, solo codice (≈3–4 giorni)**
1. Percorsi condivisibili (`?r=`) + QR code.
2. "Apri su YouTube" (playlist temporanea) + menu "Apri nella mia app" per brano.
3. Export TXT / JSPF / XSPF accanto al CSV, con mini-guida d'importazione.

**Ondata 2 — più sorgenti nel player (≈1–2 settimane)**
1. **ISRC** per tutto l'archivio (serve il client secret Spotify) → MBID da MusicBrainz.
2. **Deezer** come anteprima universale di riserva (match per ISRC).
3. **SoundCloud** come secondo player intero: link trovati via MusicBrainz e
   override manuali, senza pagare Artist Pro; motore `SoundCloudPlayer.jsx` sulla
   stessa `playbackRoute.js`.
4. **Audius** opportunistico; **Bandcamp** come link/embed a play manuale.
5. Export **ListenBrainz** (ora che ci sono gli MBID).

**Ondata 3 — scelte editoriali (da decidere)**
1. **Modalità Radio** su Mixcloud: alcuni percorsi "curati" pubblicati come show.
2. **Pilota di permessi diretti** con 2–3 etichette indipendenti della scena
   (soulful house / broken beat), audio su R2.

**Da valutare più avanti**: Play Store (TWA); webradio italiana SIAE + SCF
(solo se un pubblico solo-Italia ha senso).

**Metrica di successo**: per ogni percorso, quota di brani **ascoltabili interi
senza account** e quota **almeno in anteprima**. `resolve_sources.py --report`
va esteso per misurarle per sorgente.

---

## 7. Da verificare prima di costruire

- Deezer: JSONP ancora attivo; durata reale delle URL di anteprima.
- Audius: CORS dal dominio GitHub Pages.
- SoundCloud: quanti brani dell'archivio sono Go+ (solo 30 s negli embed).
- Bandcamp: il limite di 3 ascolti vale anche per gli embed da sloggati?
- YouTube: `watch_videos` su mobile e in YouTube Music; blocco del background nei browser mobile.
- Mixcloud: tracklist nascosta, blocchi per paese, comportamento del widget su mobile.
- SIAE: tariffa amatoriale 2026 e se i link a negozi fanno perdere lo status; SCF: clausola territoriale; Nuovo IMAIE: serve un contratto a parte?
- Cloudflare R2: supporto alle richieste Range (necessarie per lo streaming audio).

---

## 8. Decisioni richieste

1. Partire con l'**Ondata 1** (gratis, nessuna dipendenza)?
2. Per l'**Ondata 2**: va bene aggiungere SoundCloud e Deezer? Serve il client
   secret Spotify per gli ISRC.
3. Interessa una **modalità Radio** (ascolto lineare, non on-demand) su Mixcloud?
4. Interessa contattare **etichette indipendenti** per un pilota di permessi diretti?

---

## Fonti principali

- SoundCloud: developers.soundcloud.com/docs/api/html5-widget · /docs/api/register-app · help.soundcloud.com (embed Go+ = 30 s) · /docs/api/terms-of-use
- Audius: docs.audius.org/developers/guides/rest-api · /api/stream-track
- Bandcamp: get.bandcamp.help (streaming limits, embedded player) · bandcamp.com/terms_of_use
- Deezer: developers.deezer.com/guidelines · github.com/Chevron7Locked/kima-hub/issues/172 (scadenza anteprime)
- Mixcloud: help.mixcloud.com (licenze, Licensing Restrictions, upload) · mixcloud.com/developers/widget
- YouTube: developers.google.com/youtube/terms/required-minimum-functionality · /v3/determine_quota_cost · github.com/TeamNewPipe/NewPipe/issues/11930 (`watch_videos`) · news.slashdot.org 2026-02-03 (background mobile)
- ListenBrainz: github.com/metabrainz/listenbrainz-server (`playlist_api.py`, export-jspf)
- Trasferimenti: tunemymusic.com/plans · soundiiz.com/pricing · freeyourmusic.com/help
- Odesli: linktr.ee/help — sunsetting the Songlink (Odesli) public API (2026-07-31)
- SIAE: siae.it/it/utilizzatori/online/musica-streaming-download · SCF: scfitalia.it/kdocs/2217796/tariffario_scf_web_2026.pdf
- Soundreef/LEA: meiweb.it (LEA → Soundreef dal 01-01-2025) · AzuraCast: azuracast.com/docs/developers/now-playing-data
- Live365: help.live365.com (licensing coverage, stream restrictions)
- Direttiva 2014/26/UE art. 5(3) · CGUE Pelham C-476/17 · art. 70 LDA (brocardi.it)
- Cloudflare R2: developers.cloudflare.com/r2/buckets/public-buckets · Backblaze B2 pricing
- TWA: developer.chrome.com/docs/android/trusted-web-activity/quick-start
