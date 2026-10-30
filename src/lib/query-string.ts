/** Bangun query string dari objek; nilai kosong/undefined dilewati. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Ratakan searchParams Next (string | string[]) menjadi objek string. */
export async function flattenSearchParams(sp: SearchParams): Promise<Record<string, string>> {
  const raw = await sp;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") out[k] = val;
  }
  return out;
}
