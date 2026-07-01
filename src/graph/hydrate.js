// Hydrates the compact "format 2" graph.json into the rich shape the rest of
// the code expects. In format 2 the links use integer node INDICES (not the
// 22-char Spotify ids), carry no weight (recomputed from c) and the nodes
// carry no url (derivable from the id): ~50% smaller payload.
// Backward compatible: an old full-format graph.json passes through unchanged.
export function hydrateGraph(data) {
  const W = (data.meta && data.meta.linkWeights) ||
    { primary: 1.2, artist: 3.0, secondary: 0.6, playlist: 0.3 };
  for (const n of data.nodes) {
    if (!n.url) n.url = "https://open.spotify.com/track/" + n.id;
  }
  for (const l of data.links) {
    if (typeof l.source === "number") l.source = data.nodes[l.source].id;
    if (typeof l.target === "number") l.target = data.nodes[l.target].id;
    if (l.weight == null) {
      const c = l.c || [0, 0, 0, 0];
      l.weight = Math.round(
        (c[0] * W.artist + c[1] * W.primary + c[2] * W.secondary + c[3] * W.playlist) * 100
      ) / 100;
    }
  }
  return data;
}
