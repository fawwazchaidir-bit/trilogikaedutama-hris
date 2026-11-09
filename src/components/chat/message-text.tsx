import type { ReactNode } from "react";

/**
 * Isi pesan ditampilkan sebagai TEKS BIASA (React meng-escape; tidak ada HTML/markdown). Dua perkecualian aman:
 * token sebutan `@[Nama](uuid)` → "@Nama" bergaya, dan alamat https:// → tautan dengan rel noopener (hanya skema http/https).
 */
const TOKEN = /@\[([^\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)|(https?:\/\/[^\s<>"']{1,300})/g;

export function MessageText({ body, meId }: { body: string; meId: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of body.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(body.slice(last, at));
    if (m[2]) out.push(<span key={i++} className={`rounded px-1 font-medium ${m[2].toLowerCase() === meId.toLowerCase() ? "bg-amber-100 text-amber-900" : "bg-brand-50 text-brand-700"}`}>@{m[1]}</span>);
    else if (m[3]) {
      const url = m[3].replace(/[.,;:!?)]+$/, "");
      out.push(<a key={i++} href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-brand-700 underline">{url}</a>);
      if (url.length < m[3].length) out.push(m[3].slice(url.length));
    }
    last = at + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return <>{out}</>;
}
