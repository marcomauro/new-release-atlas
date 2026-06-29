#!/usr/bin/env python3
"""
check_docs.py — guardia anti-drift: verifica che i conteggi dichiarati nella
riga "Current state:" del README combacino con public/graph.json (la fonte di
verità, rigenerata in CI). Esce con codice != 0 se divergono, così il deploy
fallisce finché la doc non viene riallineata.

La riga attesa nel README (una sola, machine-checkable):
    Current state: **796 tracks · 6862 edges · 12 genres** (playlists #1–#36, ...).

Uso:  python scripts/check_docs.py
"""
import json
import re
import sys

GRAPH = "public/graph.json"
README = "README.md"


def main() -> int:
    with open(GRAPH, encoding="utf-8") as f:
        meta = json.load(f)["meta"]

    with open(README, encoding="utf-8") as f:
        readme = f.read()

    m = re.search(
        r"Current state:\s*\*\*(\d+)\s+tracks\s*·\s*(\d+)\s+edges\s*·\s*(\d+)\s+genres\*\*"
        r"\s*\(playlists\s+(#\d+[–-]#\d+(?:\s*\+\s*\d+\s+extra)?)",
        readme,
    )
    if not m:
        print('FAIL  riga "Current state: **N tracks · N edges · N genres** '
              '(playlists #A–#B ...)" non trovata in README.md')
        return 1

    doc = {
        "unique_tracks": int(m.group(1)),
        "edges": int(m.group(2)),
        "genres": int(m.group(3)),
        "playlist_range": m.group(4),
    }
    real = {k: meta.get(k) for k in doc}

    # normalizza il range: trattino (en-dash vs hyphen) e spazi multipli
    norm = lambda s: re.sub(r"\s+", " ", str(s).replace("-", "–")).strip()
    mismatches = [
        (k, doc[k], real[k])
        for k in doc
        if (norm(doc[k]) if k == "playlist_range" else doc[k]) != (
            norm(real[k]) if k == "playlist_range" else real[k]
        )
    ]

    if mismatches:
        print("FAIL  README 'Current state' non combacia con graph.json:")
        for k, d, r in mismatches:
            print(f"    {k}: README={d!r}  graph.json={r!r}")
        print("  → aggiorna la riga 'Current state:' nel README (e gli altri "
              "conteggi nei doc) con i valori reali.")
        return 1

    print(f"OK  README 'Current state' allineato a graph.json "
          f"({real['unique_tracks']} tracks · {real['edges']} edges · "
          f"{real['genres']} genres · {real['playlist_range']}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
