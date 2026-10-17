// Route navigation for players that play ONE track at a time and own the
// queue themselves (YouTube today, Apple Music next): which index comes
// next/previous given repeat, shuffle and the tracks the source cannot play.
// Pure module — no DOM, no Vite globals — so it runs under `node --test`
// (tests/playback_route.test.mjs).

// Walk the play order from `index` in `dir` (+1 / -1), skipping indices for
// which `playable(i)` is false. With repeat "all" the walk wraps around;
// otherwise it stops at the ends. Returns the next index, or -1 if none.
// `order` is a permutation of 0..count-1 (shuffle) or null (route order).
export function step({ index, count, dir = 1, repeat = "off", order = null, playable = () => true }) {
  if (count <= 0) return -1;
  const seq = order || null;
  const at = (p) => (seq ? seq[p] : p);
  let pos = seq ? seq.indexOf(index) : index;
  if (pos < 0) pos = dir > 0 ? -1 : count;
  for (let k = 1; k <= count; k++) {
    let p = pos + dir * k;
    if (p < 0 || p >= count) {
      if (repeat !== "all") return -1;
      p = ((p % count) + count) % count;
    }
    const i = at(p);
    if (playable(i)) return i;
  }
  return -1;
}

// `index` itself when playable, else the next playable one (no wrap).
export function firstPlayable({ index, count, order = null, playable = () => true }) {
  if (index >= 0 && index < count && playable(index)) return index;
  return step({ index, count, dir: 1, order, playable });
}

// What to do when the current track ends: repeat "one" replays it, otherwise
// move on (wrapping only with repeat "all"). -1 = the route is over.
export function afterEnd({ index, count, repeat = "off", order = null, playable = () => true }) {
  if (repeat === "one" && playable(index)) return index;
  return step({ index, count, dir: 1, repeat, order, playable });
}

// Shuffled play order that starts from `first` (the track playing when
// shuffle is switched on keeps playing). `random` is injectable for tests.
export function shuffledOrder(count, first = 0, random = Math.random) {
  const rest = [];
  for (let i = 0; i < count; i++) if (i !== first) rest.push(i);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 && first < count ? [first, ...rest] : rest;
}
