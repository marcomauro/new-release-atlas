// Text helpers that survive pathological Unicode.
//
// Some Spotify titles are published under Zalgo-style pseudonyms: hundreds of
// combining marks stacked on a few base characters (one archive title is 255
// code points / 501 UTF-8 bytes / 206 combining marks). Those strings are kept
// VERBATIM in the data — they are the real title — so it is the display layer
// that must be robust.

// Grapheme-aware truncation. Slicing by code point splits a base+combining
// sequence and produces mojibake (or moves marks onto the ellipsis); counting
// user-perceived characters instead keeps every cluster whole. Intl.Segmenter
// is available in every browser we target; the fallback keeps old engines safe
// by never cutting in the middle of a combining run.
export function truncateGraphemes(s, max) {
  if (!s) return s;
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const out = [];
    for (const { segment } of seg.segment(s)) {
      out.push(segment);
      if (out.length > max) return out.slice(0, max - 1).join("") + "…";
    }
    return s;
  }
  if (s.length <= max) return s;
  let cut = max - 1;
  // walk back out of a combining-mark run (Unicode Mn/Me/Mc ranges)
  while (cut > 0 && /\p{M}/u.test(s[cut])) cut--;
  return s.slice(0, cut) + "…";
}
