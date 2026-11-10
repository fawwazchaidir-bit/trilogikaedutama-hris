/** Aturan murni corong penjualan surat penawaran (tanpa database). Mengikuti Register Excel: status & perhitungan dasbor. */

export type CommercialStatus = "SENT" | "FOLLOW_UP" | "NEGOTIATION" | "DEAL" | "REJECTED" | "DONE";
/** Status tampilan = status komersial setelah terbit, atau diturunkan dari siklus surat (Draf / Batal). */
export type DisplayStatus = "DRAFT" | CommercialStatus | "CANCELLED";

export const COMMERCIAL_STATUSES: readonly CommercialStatus[] = ["SENT", "FOLLOW_UP", "NEGOTIATION", "DEAL", "REJECTED", "DONE"];
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  DRAFT: "Draft", SENT: "Terkirim", FOLLOW_UP: "Follow-up", NEGOTIATION: "Negosiasi", DEAL: "Deal", REJECTED: "Tolak", DONE: "Selesai", CANCELLED: "Batal",
};
/** Pipeline aktif: sudah dikirim, belum diputuskan. */
export const PIPELINE: readonly DisplayStatus[] = ["SENT", "FOLLOW_UP", "NEGOTIATION"];
/** Dihitung sebagai penawaran terkirim (Excel: Terkirim s.d. Tolak). */
export const SENT_OR_DECIDED: readonly DisplayStatus[] = ["SENT", "FOLLOW_UP", "NEGOTIATION", "DEAL", "REJECTED"];

export interface StatusInput { letterStatus: "DRAFT" | "IN_REVIEW" | "RETURNED" | "ISSUED" | "REJECTED" | "CANCELLED"; commercialStatus: CommercialStatus | null }
export function displayStatus(d: StatusInput): DisplayStatus {
  if (d.letterStatus === "CANCELLED" || d.letterStatus === "REJECTED") return "CANCELLED";
  if (d.letterStatus !== "ISSUED") return "DRAFT";
  return d.commercialStatus ?? "DRAFT"; // sudah terbit tetapi belum ditandai terkirim = masih "Draft" (siap dikirim)
}

/** Kemenangan: Deal, atau Selesai yang pernah bernilai deal (agar pendapatan tidak hilang saat proyek selesai). */
export const isWon = (status: DisplayStatus, dealValue: number | null): boolean => status === "DEAL" || (status === "DONE" && (dealValue ?? 0) > 0);

/** Alert follow-up (kolom "Alert FU"): TERLAMBAT bila jadwal sudah lewat dan penawaran masih di pipeline. */
export function followUpAlert(status: DisplayStatus, followUpAt: string | null, today: string): "TERLAMBAT" | "HARI_INI" | null {
  if (!followUpAt || !PIPELINE.includes(status)) return null;
  return followUpAt < today ? "TERLAMBAT" : followUpAt === today ? "HARI_INI" : null;
}

/** Syarat memindahkan ke Deal: nilai deal > 0 dan bukti (berkas PO) atau catatan. */
export function dealProblems(input: { dealValue: number | null; hasEvidence: boolean; note: string | null }): string[] {
  const out: string[] = [];
  if (!input.dealValue || input.dealValue <= 0) out.push("Isi nilai deal (Rp).");
  if (!input.hasEvidence && (input.note ?? "").trim().length < 3) out.push("Unggah bukti (PO/persetujuan klien, PDF atau JPG) atau tulis catatan bukti.");
  return out;
}

/** Perpindahan status yang sah: bebas di antara tahap berjalan; keputusan akhir dapat dikoreksi; "Selesai" final. */
export function canTransition(from: DisplayStatus, to: CommercialStatus): boolean {
  if (from === "CANCELLED") return false;
  if (from === "DONE") return false;
  if (to === "DONE") return from === "DEAL";
  return from !== to;
}
