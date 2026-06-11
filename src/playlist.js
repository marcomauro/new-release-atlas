/* ----------------------------------------------------------------
   playlist.js — motore di generazione playlist a regole (no AI/API).
   Interpreta un messaggio in linguaggio naturale (IT/EN) ed estrae
   generi / mood / artista-seed / numero di brani, poi costruisce una
   playlist NAVIGANDO il grafo (link pesati: artista condiviso, genere
   condiviso, co-playlist). Tutto client-side, deterministico.

   API:  buildPlaylist(graph, message) -> {
            ids, tracks, totalSeconds, totalLabel,
            theme, interpretation, note, ok
          }
   ---------------------------------------------------------------- */

const GENRE_LABEL = {
  "neo-soul": "Neo-Soul/R&B", "electronic": "Electronic", "jazz": "Jazz",
  "alt": "Alt/Indie", "uk-jazz": "UK Jazz", "hip-hop": "Hip-Hop",
  "world": "World/Afro/Latin", "soulful-house": "Soulful House",
  "soul-funk": "Soul/Funk", "broken-beat": "Broken Beat",
  "classical": "Classical/Score", "unknown": "Unclassified",
};

// sinonimi/parole-chiave -> genere (substring, normalizzati)
const GENRE_SYNONYMS = {
  "soulful-house": ["soulful house", "soulful", "deep house", "house", "garage", "afro house"],
  "broken-beat": ["broken beat", "broken-beat", "bruk", "future jazz", "future-jazz", "club jazz"],
  "uk-jazz": ["uk jazz", "uk-jazz", "london jazz", "jazz londinese", "jazz inglese", "nu jazz"],
  "jazz": ["jazz", "spiritual jazz", "fusion", "straight ahead", "be bop", "bebop"],
  "neo-soul": ["neo soul", "neo-soul", "neosoul", "r&b", "rnb", "rhythm and blues", "future soul"],
  "soul-funk": ["soul funk", "soul-funk", "funk", "disco", "boogie", "soul"],
  "hip-hop": ["hip hop", "hip-hop", "hiphop", "rap", "boom bap", "boom-bap", "trap", "conscious"],
  "electronic": ["electronic", "elettronica", "elettronico", "techno", "idm", "ambient", "downtempo", "bass", "leftfield", "dub", "house music"],
  "world": ["world", "afrobeat", "afro", "latin", "latino", "brasil", "brazil", "india", "global", "etnica", "etnico", "cumbia"],
  "alt": ["alternative", "indie", "rock", "art pop", "art-pop", "singer songwriter", "cantautor", "pop"],
  "classical": ["classica", "classical", "classico", "colonna sonora", "soundtrack", "orchestral", "orchestra", "score", "strumentale", "ambientale"],
};

const MOODS = {
  relaxed: {
    kw: ["relax", "chill", "calm", "quiet", "mellow", "soft", "slow", "evening", "night", "study", "studying", "reading", "read", "sleep", "dinner", "lounge", "sunday", "rilassante", "rilassat", "calmo", "tranquill", "sera", "serata", "notte", "lettura", "lent", "dormire", "cena"],
    genres: ["neo-soul", "jazz", "classical", "electronic", "soul-funk"],
  },
  energetic: {
    kw: ["energetic", "energy", "upbeat", "party", "dance", "dancing", "gym", "workout", "running", "morning", "hype", "pump", "summer", "energic", "carica", "festa", "ballare", "ballo", "palestra", "allenament", "corsa", "mattina", "sveglia", "estate"],
    genres: ["soulful-house", "broken-beat", "electronic", "hip-hop", "world"],
  },
  focus: {
    kw: ["focus", "concentrate", "concentration", "working", "productive", "coding", "deep work", "concentr", "lavoro", "lavorare", "studiare", "produttiv", "programmare"],
    genres: ["jazz", "classical", "electronic"],
  },
  groove: {
    kw: ["groove", "groovy", "funky", "rhythm", "dancefloor", "club", "warm up", "warmup", "ritmo", "aperitivo"],
    genres: ["soul-funk", "soulful-house", "broken-beat", "neo-soul"],
  },
};

const SIZE_WORDS = {
  "a dozen": 12, "dozen": 12, "handful": 8, "short": 8, "brief": 8, "quick": 8,
  "long": 30, "lengthy": 30, "huge": 40, "marathon": 40,
  "decina": 10, "quindicina": 15, "ventina": 20, "trentina": 30,
  "poche": 8, "breve": 8, "corta": 8, "cortissima": 6,
  "lunga": 30, "tante": 30, "molte": 30, "maratona": 40,
};

const norm = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

function parseSize(msg) {
  const m = msg.match(/(\d{1,3})\s*(?:brani|tracce|canzoni|pezzi|songs|tracks|titoli)?/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 2 && n <= 80) return Math.max(5, Math.min(40, n));
  }
  for (const [w, n] of Object.entries(SIZE_WORDS)) if (msg.includes(w)) return n;
  return 18;
}

function detectGenres(msg) {
  const explicit = new Set();
  for (const [g, syns] of Object.entries(GENRE_SYNONYMS))
    if (syns.some((s) => msg.includes(s))) explicit.add(g);

  const mood = new Set();
  let moodName = null;
  for (const [name, def] of Object.entries(MOODS))
    if (def.kw.some((k) => msg.includes(k))) {
      def.genres.forEach((g) => mood.add(g));
      moodName = moodName || name;
    }
  return { explicit, mood, moodName };
}

const CUES = [
  "similar to ", "sounds like ", "in the style of ", "stuff like ", "vibe of ", "like ",
  "simile a ", "simili a ", "tipo ", "stile di ", "stile ", "come ",
  "alla maniera di ", "sound di ", "vibe di ", "ispirat", "tipo:",
];
const CUT_AFTER = [
  ",", " but only ", " but ", " only ", " with ", " without ", " and then ",
  " ma ", " pero ", " ma solo ", " solo ", " con ", " senza ", " e poi ", " in stile ",
];

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (name, msg) =>
  name.length >= 4 && new RegExp(`(^|[^a-z0-9])${escRe(name)}([^a-z0-9]|$)`).test(msg);

// estrae la query dopo un cue ("tipo X", "simile a X"), troncata ai connettori
function extractCueQuery(msg) {
  for (const cue of CUES) {
    const i = msg.indexOf(cue);
    if (i === -1) continue;
    let tail = msg.slice(i + cue.length).trim();
    for (const c of CUT_AFTER) {
      const j = tail.indexOf(c);
      if (j > 0) tail = tail.slice(0, j).trim();
    }
    tail = tail.split(/\s+/).slice(0, 3).join(" ").trim();
    if (tail.length >= 3) return tail;
  }
  return null;
}

// nodo seed da una query libera: cerca lato-nodo (artista forte, titolo debole),
// preferendo il piu centrale. Gestisce nomi presenti solo nei titoli (es. remix).
function seedFromQuery(query, graph) {
  const q = norm(query);
  let bestPrimary = null, bestArtist = null, bestTitle = null;
  for (const n of graph.nodes) {
    const pa = norm(n.artist);
    const arts = norm((n.artists || []).join(" | "));
    if (pa && (pa.includes(q) || q.includes(pa))) {
      if (!bestPrimary || n.degree > bestPrimary.degree) bestPrimary = n;
    } else if (arts.includes(q)) {
      if (!bestArtist || n.degree > bestArtist.degree) bestArtist = n;
    } else if (norm(n.title).includes(q)) {
      if (!bestTitle || n.degree > bestTitle.degree) bestTitle = n;
    }
  }
  return bestPrimary || bestArtist || bestTitle;
}

// nome d'artista presente nel messaggio (match a confine di parola, piu lungo);
// usato solo quando non ci sono cue ne generi/mood (es. l'utente scrive un nome).
function seedFromArtist(msg, graph) {
  const seen = new Map(); // artista normalizzato -> lunghezza
  for (const n of graph.nodes)
    for (const a of n.artists || []) {
      const na = norm(a);
      if (na.length >= 4 && !seen.has(na)) seen.set(na, na.length);
    }
  let bestName = null, bestLen = 0;
  for (const na of seen.keys())
    if (wordHit(na, msg) && na.length > bestLen) { bestName = na; bestLen = na.length; }
  if (!bestName) return null;
  return graph.nodes
    .filter((n) => (n.artists || []).some((a) => norm(a) === bestName))
    .sort((a, b) => b.degree - a.degree)[0] || null;
}

// parole che indicano un GENERE, non un artista (per non scambiare "like jazz")
const GENRE_WORDS = new Set(
  Object.values(GENRE_SYNONYMS).flat().concat(Object.keys(GENRE_LABEL))
);

// priority: cue ("like X") > explicit genres/mood > bare artist > none
function findSeed(msg, graph, { explicit, mood }) {
  const cueQuery = extractCueQuery(msg);
  // "like jazz" non e' un seed: se la query e' un genere, lascia il ramo generi
  if (cueQuery && !GENRE_WORDS.has(cueQuery)) {
    const s = seedFromQuery(cueQuery, graph);
    if (s) return s;
  }
  if (!explicit.size && !mood.size) return seedFromArtist(msg, graph);
  return null;
}

// Pesi default dei legami (gerarchia: genere primario > artista > genere
// secondario > stessa playlist). Sovrascrivibili a runtime dall'utente.
export const DEFAULT_LINK_WEIGHTS = { primary: 3.0, artist: 2.0, secondary: 1.0, playlist: 0.4 };

// peso effettivo di un arco dati i componenti c=[artista,primario,secondario,playlist]
// e i pesi scelti. Fallback al peso pre-calcolato se mancano i componenti.
function linkWeight(l, w) {
  const c = l.c;
  if (!c) return l.weight || 1;
  return c[0] * w.artist + c[1] * w.primary + c[2] * w.secondary + c[3] * w.playlist;
}

function resolveWeights(graph, weights) {
  return weights || (graph.meta && graph.meta.linkWeights) || DEFAULT_LINK_WEIGHTS;
}

function buildAdjacency(graph, weights) {
  const w = resolveWeights(graph, weights);
  const adj = new Map();
  graph.nodes.forEach((n) => adj.set(n.id, new Map()));
  graph.links.forEach((l) => {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    const val = linkWeight(l, w);
    if (val <= 0) return; // categoria azzerata dall'utente -> nessun legame
    adj.get(s)?.set(t, (adj.get(s).get(t) || 0) + val);
    adj.get(t)?.set(s, (adj.get(t).get(s) || 0) + val);
  });
  return adj;
}

const parseDur = (d) => {
  const m = /^(\d+):(\d{1,2})$/.exec(d || "");
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 210;
};
function fmtDur(sec) {
  const min = Math.round(sec / 60);
  if (min < 60) return `≈ ${min} min`;
  return `≈ ${Math.floor(min / 60)} h ${min % 60} min`;
}

// Fattore random di default per la varieta' (0 = deterministico, 1 = molto vario).
export const DEFAULT_RANDOMNESS = 0.4;

// --- Mood / atmosfera ------------------------------------------------------
// Parametri 0–1 sui nodi (energy/valence/danceability/acousticness/
// instrumentalness). Guidano la generazione SENZA toccare il grafo: sono un
// termine di ri-ordinamento (vicinanza a un target), non aggiungono legami.
export const DEFAULT_MOOD = {
  influence: 0,
  target: { energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, instrumentalness: 0.5 },
};
const MOOD_DIMS = ["energy", "valence", "danceability", "acousticness", "instrumentalness"];
const MOOD_W = 2.5; // scala del termine mood, comparabile ai pesi dei legami

// parole-chiave (IT/EN) che spingono una dimensione verso alto/basso
const MOOD_PARAM_CUES = {
  energy: {
    hi: ["energetic", "energy", "upbeat", "hype", "pump", "driving", "intens", "energic", "carica", "potente", "spinta", "adrenalin"],
    lo: ["calm", "chill", "relaxed", "mellow", "gentle", "quiet", "calmo", "tranquill", "rilassant", "morbid", "delicat", "soffuso"],
  },
  valence: {
    hi: ["happy", "uplifting", "bright", "sunny", "joyful", "positive", "feel good", "allegro", "solare", "felice", "positiv", "luminos", "gioios"],
    lo: ["sad", "melanchol", "dark", "moody", "somber", "wistful", "malinconic", "triste", "cupo", "nostalgic", "tetro", "agrodolce"],
  },
  danceability: {
    hi: ["danc", "groovy", "funky", "ballabil", "ballare", "groove", "danzant", "ritmat"],
    lo: ["drone", "beatless", "rarefatt", "atmosferic"],
  },
  acousticness: {
    hi: ["acoustic", "unplugged", "acustic", "suoni veri"],
    lo: ["synth", "sintetic", "digitale"],
  },
  instrumentalness: {
    hi: ["instrumental", "no vocals", "strumental", "senza voce", "senza parole"],
    lo: ["vocal", "sung", "lyrics", "vocale", "cantat", "parole"],
  },
};

function detectMoodParams(msg) {
  const target = {};
  let any = false;
  for (const dim of MOOD_DIMS) {
    const cue = MOOD_PARAM_CUES[dim];
    if (cue.hi.some((k) => msg.includes(k))) { target[dim] = 0.85; any = true; }
    else if (cue.lo.some((k) => msg.includes(k))) { target[dim] = 0.15; any = true; }
  }
  return { target, any };
}

// Il testo (se contiene parole di mood) ha la precedenza sui cursori manuali;
// altrimenti valgono i cursori. influence 0 => mood ignorato (comportamento base).
function effectiveMood(manualMood, msg) {
  const nl = detectMoodParams(msg);
  if (nl.any) {
    const target = {};
    for (const d of MOOD_DIMS) target[d] = nl.target[d] != null ? nl.target[d] : null;
    return { influence: Math.max(0.6, (manualMood && manualMood.influence) || 0), target };
  }
  if (manualMood && manualMood.influence > 0)
    return { influence: manualMood.influence, target: { ...manualMood.target } };
  return { influence: 0, target: {} };
}

// vicinanza 0–1 di un nodo al target di mood (media sulle dimensioni specificate)
function moodScore(n, mood) {
  if (!mood || !mood.influence) return 0;
  let sum = 0, k = 0;
  for (const d of MOOD_DIMS) {
    const t = mood.target[d];
    if (t == null || n[d] == null) continue;
    sum += 1 - Math.abs(n[d] - t);
    k++;
  }
  return k ? sum / k : 0;
}
const moodTerm = (n, mood) => (mood && mood.influence ? MOOD_W * mood.influence * moodScore(n, mood) : 0);

const MOOD_HI = { energy: "energetic", valence: "positive", danceability: "danceable", acousticness: "acoustic", instrumentalness: "instrumental" };
const MOOD_LO = { energy: "calm", valence: "melancholic", danceability: "mellow", acousticness: "electronic", instrumentalness: "vocal" };
function moodLabel(mood) {
  if (!mood || !mood.influence) return "";
  const parts = [];
  for (const d of MOOD_DIMS) {
    const t = mood.target[d];
    if (t == null) continue;
    if (t >= 0.6) parts.push(MOOD_HI[d]);
    else if (t <= 0.4) parts.push(MOOD_LO[d]);
  }
  return parts.join(", ");
}

// ordina un insieme di id in un "percorso" coerente (nearest-neighbor sui link).
// Regola: mai lo stesso artista in due posizioni consecutive (se evitabile).
function routeOrder(ids, adj, byId, startId) {
  const remaining = new Set(ids);
  let current = startId && remaining.has(startId)
    ? startId
    : [...remaining].sort((a, b) => byId.get(b).degree - byId.get(a).degree)[0];
  const order = [];
  while (remaining.size) {
    order.push(current);
    remaining.delete(current);
    if (!remaining.size) break;
    const curArtist = byId.get(current).artist;
    const links = adj.get(current) || new Map();
    // candidati con artista diverso; solo se non ce ne sono si ammette lo stesso
    let pool = [...remaining].filter((r) => byId.get(r).artist !== curArtist);
    if (!pool.length) pool = [...remaining];
    let next = null, bestW = -1;
    for (const r of pool) {
      const w = links.get(r) || 0;
      if (w > bestW) { bestW = w; next = r; }
    }
    if (bestW <= 0) {
      // nessun legame diretto: prendi il piu centrale tra i candidati ammessi
      next = pool.sort((a, b) => byId.get(b).degree - byId.get(a).degree)[0];
    }
    current = next;
  }
  return order;
}

function tracksOf(ids, byId) {
  return ids.map((id) => {
    const n = byId.get(id);
    return {
      id, title: n.title, artist: n.artist, artists: n.artists,
      genre: n.genre, genreLabel: GENRE_LABEL[n.genre] || n.genre,
      duration: n.duration, url: n.url,
    };
  });
}

export function buildPlaylist(graph, rawMessage, weights, randomness = DEFAULT_RANDOMNESS, moodArg) {
  const msg = norm(rawMessage);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(graph, weights);
  const size = parseSize(msg);
  // mood effettivo: dal testo (parole di mood) o dai cursori manuali
  const moodCfg = effectiveMood(moodArg, msg);

  const { explicit, mood, moodName } = detectGenres(msg);
  const seed = findSeed(msg, graph, { explicit, mood });
  const target = explicit.size ? explicit : mood.size ? mood : null;
  const inTarget = (n) =>
    !target ? false : (target.has(n.genre) || (n.genres || []).some((g) => target.has(g)));

  const maxDeg = Math.max(1, ...graph.nodes.map((n) => n.degree));
  const artistCount = new Map();
  const canAdd = (n, cap = 2) => (artistCount.get(n.artist) || 0) < cap;
  const note = (n) => artistCount.set(n.artist, (artistCount.get(n.artist) || 0) + 1);

  let chosen = [];
  let theme, interpretation, caveat = "";

  if (seed) {
    // ---- crescita greedy attorno al seed: ad ogni passo aggiunge il brano
    //      con la massima affinita (somma pesi link) verso l'insieme corrente.
    const chosenSet = new Set([seed.id]);
    chosen = [seed.id];
    note(seed);
    while (chosen.length < size) {
      let best = null, bestScore = -Infinity;
      for (const cand of graph.nodes) {
        if (chosenSet.has(cand.id) || !canAdd(cand)) continue;
        let aff = 0;
        const links = adj.get(cand.id) || new Map();
        for (const cid of chosen) aff += links.get(cid) || 0;
        const gb = target ? (target.has(cand.genre) ? 0.8 : inTarget(cand) ? 0.4 : 0) : 0;
        const score = aff + gb + 0.04 * (cand.degree / maxDeg) + moodTerm(cand, moodCfg) + randomness * 1.5 * Math.random();
        if (score > bestScore && (aff > 0 || gb > 0)) { bestScore = score; best = cand; }
      }
      if (!best) {
        // fallback: stesso genere primario del seed, per centralita
        best = graph.nodes
          .filter((n) => !chosenSet.has(n.id) && n.genre === seed.genre && canAdd(n))
          .sort((a, b) => b.degree - a.degree)[0];
      }
      if (!best) break;
      chosen.push(best.id); chosenSet.add(best.id); note(best);
    }
    chosen = routeOrder(chosen, adj, byId, seed.id);
    theme = `like ${seed.artist}`;
    interpretation =
      `seed "${seed.title}" — ${seed.artist}` +
      (target ? ` · filter ${[...target].map((g) => GENRE_LABEL[g]).join(", ")}` : "");
  } else if (target) {
    // ---- selezione per generi/mood: punteggio = match genere + centralita ----
    const pool = graph.nodes.filter(inTarget);
    const primaryCount = pool.filter((n) => target.has(n.genre)).length;
    const scored = pool
      .map((n) => ({
        n,
        s: (target.has(n.genre) ? 2 : 1) + (n.degree / maxDeg) + moodTerm(n, moodCfg) + randomness * 1.5 * Math.random(),
      }))
      .sort((a, b) => b.s - a.s);
    // round-robin per genere richiesto, con diversita d'artista
    const genres = [...target];
    const buckets = new Map(genres.map((g) => [g, []]));
    scored.forEach(({ n }) => {
      const g = target.has(n.genre) ? n.genre : (n.genres || []).find((x) => target.has(x));
      if (g && buckets.has(g)) buckets.get(g).push(n);
    });
    const picked = new Set();
    let progress = true;
    while (chosen.length < size && progress) {
      progress = false;
      for (const g of genres) {
        const list = buckets.get(g);
        while (list.length) {
          const n = list.shift();
          if (picked.has(n.id) || !canAdd(n)) continue;
          picked.add(n.id); chosen.push(n.id); note(n); progress = true;
          break;
        }
        if (chosen.length >= size) break;
      }
    }
    chosen = routeOrder(chosen, adj, byId);
    const lbls = [...target].map((g) => GENRE_LABEL[g]).join(", ");
    theme = moodName && !explicit.size ? `mood ${moodName}` : lbls;
    interpretation =
      (explicit.size ? `genres ${lbls}` : `mood ${moodName} → ${lbls}`);
    if (primaryCount < chosen.length)
      caveat = ` · only ${primaryCount} tracks with the requested primary genre, added related ones`;
  } else {
    // ---- nessun appiglio: mix "scoperta" bilanciato tra le community ----
    const byComm = new Map();
    graph.nodes.forEach((n) => {
      if (!byComm.has(n.community)) byComm.set(n.community, []);
      byComm.get(n.community).push(n);
    });
    const discScore = (n) => n.degree / maxDeg + moodTerm(n, moodCfg) + (Math.random() - Math.random()) * randomness * 3;
    for (const list of byComm.values()) {
      const sc = new Map(list.map((n) => [n.id, discScore(n)]));
      list.sort((a, b) => sc.get(b.id) - sc.get(a.id));
    }
    const comms = [...byComm.keys()].sort((a, b) => a - b);
    let progress = true;
    while (chosen.length < size && progress) {
      progress = false;
      for (const c of comms) {
        const list = byComm.get(c);
        while (list.length) {
          const n = list.shift();
          if (!canAdd(n)) continue;
          chosen.push(n.id); note(n); progress = true; break;
        }
        if (chosen.length >= size) break;
      }
    }
    chosen = routeOrder(chosen, adj, byId);
    theme = "discovery mix";
    interpretation = "no genre/artist recognized → a mix across all clusters";
  }

  const mlabel = moodLabel(moodCfg);
  if (mlabel) interpretation += ` · mood: ${mlabel}`;

  const tracks = tracksOf(chosen, byId);
  const totalSeconds = tracks.reduce((s, t) => s + parseDur(t.duration), 0);

  return {
    ok: tracks.length > 0,
    ids: chosen,
    tracks,
    totalSeconds,
    totalLabel: fmtDur(totalSeconds),
    theme,
    interpretation,
    note:
      `${tracks.length} tracks · ${fmtDur(totalSeconds)} — ${interpretation}${caveat}. ` +
      `The tracks are highlighted on the map and linked in listening order.`,
  };
}

// Costruisce una playlist usando un NODO come seed, crescendo SOLO lungo le
// connessioni del grafo (artista/genere/co-playlist condivisi). Usata dal
// pannello di dettaglio: "Generate playlist" dal brano selezionato.
export function buildFromSeed(graph, seedNode, size = 18, weights, randomness = DEFAULT_RANDOMNESS, mood) {
  if (!seedNode)
    return { ok: false, ids: [], tracks: [], totalSeconds: 0, totalLabel: "", theme: "", interpretation: "", note: "" };

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(graph, weights);
  const maxDeg = Math.max(1, ...graph.nodes.map((n) => n.degree));
  const artistCount = new Map();
  const canAdd = (n, cap = 2) => (artistCount.get(n.artist) || 0) < cap;
  const note = (n) => artistCount.set(n.artist, (artistCount.get(n.artist) || 0) + 1);

  const chosenSet = new Set([seedNode.id]);
  let chosen = [seedNode.id];
  note(seedNode);
  while (chosen.length < size) {
    let best = null, bestScore = -Infinity;
    for (const cand of graph.nodes) {
      if (chosenSet.has(cand.id) || !canAdd(cand)) continue;
      let aff = 0;
      const links = adj.get(cand.id) || new Map();
      for (const cid of chosen) aff += links.get(cid) || 0;
      if (aff <= 0) continue; // segui SOLO le connessioni del grafo
      const score = aff + 0.04 * (cand.degree / maxDeg) + moodTerm(cand, mood) + randomness * 1.5 * Math.random();
      if (score > bestScore) { bestScore = score; best = cand; }
    }
    if (!best) {
      // se il seed ha pochi legami, completa col suo stesso genere primario
      best = graph.nodes
        .filter((n) => !chosenSet.has(n.id) && n.genre === seedNode.genre && canAdd(n))
        .sort((a, b) => b.degree - a.degree)[0];
    }
    if (!best) break;
    chosen.push(best.id); chosenSet.add(best.id); note(best);
  }
  chosen = routeOrder(chosen, adj, byId, seedNode.id);

  const ml = moodLabel(mood);
  const tracks = tracksOf(chosen, byId);
  const totalSeconds = tracks.reduce((s, t) => s + parseDur(t.duration), 0);
  return {
    ok: tracks.length > 0,
    ids: chosen,
    tracks,
    totalSeconds,
    totalLabel: fmtDur(totalSeconds),
    theme: seedNode.title,
    interpretation: `from "${seedNode.title}" — ${seedNode.artist}, via graph connections` + (ml ? ` · mood: ${ml}` : ""),
    note:
      `${tracks.length} tracks · ${fmtDur(totalSeconds)} — built from "${seedNode.title}" by ${seedNode.artist}, ` +
      `following the graph connections (shared artist / genre). Highlighted on the map in listening order.`,
  };
}

export { GENRE_LABEL };
