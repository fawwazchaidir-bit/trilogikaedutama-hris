/** Format tampilan murni untuk indikator (tanpa DB). */
import type { Anchor } from "./config";

/** "H-7", "H+1 (hari terakhir)", "T+2 hari kerja", "K03+2 hari kerja", "Diisi manual". */
export function offsetLabel(o: { anchor: Anchor; days: number; work: boolean; ref?: string | null }): string {
  if (o.anchor === "MANUAL") return "Diisi manual";
  const base = o.anchor === "H" ? "H" : o.anchor === "H_END" ? "H (hari terakhir)" : o.anchor === "T" ? "T" : (o.ref ?? "?");
  const sign = o.days === 0 ? "" : o.days > 0 ? `+${o.days}` : `${o.days}`;
  return `${base}${sign}${o.work && o.days !== 0 ? " hari kerja" : ""}`;
}

/** Angka beban/rasio untuk tampilan: tak terhingga ditulis ">999". */
export const fmtPct = (n: number | null): string => (n === null ? "—" : !Number.isFinite(n) || n > 999 ? ">999%" : `${Math.round(n)}%`);
export const fmtNum = (n: number | null, d = 2): string => (n === null ? "—" : !Number.isFinite(n) ? "∞" : n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d }));
