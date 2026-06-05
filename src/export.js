/* ----------------------------------------------------------------
   export.js — export "senza setup" di una playlist generata.
   Nessun login, nessun client id: produciamo i LINK Spotify esatti
   (li abbiamo gia nel grafo) + un CSV, e li passiamo a un tool esterno
   che crea la playlist (es. Spotlistr) oppure si incollano in Spotify.
   ---------------------------------------------------------------- */

// Pagina di Spotlistr dove si incolla una tracklist / si caricano file.
export const SPOTLISTR_URL = "https://www.spotlistr.com/search";

// Una riga per brano: link Spotify (match esatto in Spotlistr e nell'app Spotify).
export function playlistLinks(res) {
  return (res.tracks || []).map((t) => t.url).filter(Boolean).join("\n");
}

// CSV con titolo/artista/link (per Soundiiz, fogli di calcolo, archivio).
export function playlistCsv(res) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = ["title,artist,spotify_url"];
  (res.tracks || []).forEach((t) =>
    rows.push([esc(t.title), esc((t.artists || [t.artist]).join(", ")), esc(t.url)].join(","))
  );
  return rows.join("\n");
}

export function exportFilename(res, ext) {
  const slug = (res.theme || "playlist")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40) || "playlist";
  return `atlas-${slug}.${ext}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function downloadFile(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
