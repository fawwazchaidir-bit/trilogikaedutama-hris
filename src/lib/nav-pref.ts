/**
 * Preferensi tampilan sidebar (disembunyikan? grup mana yang dilipat?) — murni, dipakai server (membaca cookie → tanpa kedip
 * saat dimuat) dan klien (menulis cookie). Bukan data sensitif; nilai tak dipercaya dan selalu divalidasi ulang.
 *
 * Format cookie: "<0|1>:<grup>.<grup>"  — mis. "0:training.sistem" (sidebar terbuka; grup training & sistem dilipat). Bawaan: terbuka, semua grup terbuka.
 */
export const NAV_PREF_COOKIE = "portal_nav";
export const NAV_GROUP_IDS = ["umum", "saya", "sdm", "gaji", "training", "sistem"] as const;
export type NavGroupId = (typeof NAV_GROUP_IDS)[number];

export interface NavPref { collapsed: boolean; closedGroups: NavGroupId[] }
export const DEFAULT_NAV_PREF: NavPref = { collapsed: false, closedGroups: [] };

export function parseNavPref(raw: string | null | undefined): NavPref {
  if (typeof raw !== "string" || raw.length > 120) return { ...DEFAULT_NAV_PREF, closedGroups: [] };
  const [c, g = ""] = raw.split(":");
  const closed = [...new Set(g.split(".").filter((x): x is NavGroupId => (NAV_GROUP_IDS as readonly string[]).includes(x) && x !== "umum"))];
  return { collapsed: c === "1", closedGroups: closed };
}

/** Tulis cookie preferensi (hanya dipanggil di browser). Gagal diam-diam: preferensi tidak wajib tersimpan. */
export function writeNavPrefCookie(p: NavPref): void {
  try {
    document.cookie = `${NAV_PREF_COOKIE}=${serializeNavPref(p)}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  } catch { /* abaikan */ }
}

export function serializeNavPref(p: NavPref): string {
  return `${p.collapsed ? "1" : "0"}:${[...new Set(p.closedGroups)].filter((x) => x !== "umum").join(".")}`;
}
