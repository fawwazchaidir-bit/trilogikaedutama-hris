/** Aturan murni siklus & kewenangan persuratan (tanpa database) — dipakai service, UI, dan tes. */

export type LetterStatus = "DRAFT" | "IN_REVIEW" | "RETURNED" | "ISSUED" | "REJECTED" | "CANCELLED";
export type JobLevel = "STAFF" | "SUPERVISOR" | "MANAGER";

export const LETTER_STATUS_LABEL: Record<LetterStatus, string> = {
  DRAFT: "Draf", IN_REVIEW: "Menunggu penandatangan", RETURNED: "Dikembalikan", ISSUED: "Terbit", REJECTED: "Ditolak", CANCELLED: "Dibatalkan",
};
export const LETTER_SERIES_LABEL = { EKS: "Eksternal", INT: "Internal" } as const;

/** Hanya Draf/Dikembalikan yang boleh disunting (oleh pembuatnya). */
export const isEditable = (s: LetterStatus): boolean => s === "DRAFT" || s === "RETURNED";

export interface SignerPolicy { directorOnly: boolean; signerJobLevels: JobLevel[]; hrCanSign?: boolean; /** Kosong/tiada = semua divisi. Hanya berlaku bagi penandatangan tingkat jabatan (Direktur & HR tidak terikat divisi). */ signerDivisionIds?: string[] }
export interface PersonFacts { role: "EMPLOYEE" | "HR_ADMIN" | "SUPER_ADMIN"; jobLevel: JobLevel | null; isIntern: boolean; isActive: boolean; divisionId?: string | null }

/** Direktur = Super Admin. Selain itu tingkat jabatan yang diizinkan jenis surat, atau HR (role Admin/HR) bila jenis mengizinkan; Magang tidak pernah. */
export function isEligibleSigner(policy: SignerPolicy, p: PersonFacts): boolean {
  if (!p.isActive || p.isIntern) return false;
  if (p.role === "SUPER_ADMIN") return true;
  if (policy.directorOnly) return false;
  if (policy.hrCanSign && p.role === "HR_ADMIN") return true;
  if (!p.jobLevel || !policy.signerJobLevels.includes(p.jobLevel)) return false;
  // Pembatasan divisi: mis. penawaran hanya Manajer divisi Pemasaran; berita acara hanya Manajer divisi Operasional.
  if (policy.signerDivisionIds?.length) return !!p.divisionId && policy.signerDivisionIds.includes(p.divisionId);
  return true;
}

/** Pembuat yang bukan Direktur tidak boleh menjadi penandatangan dokumennya sendiri. */
export function canSignOwn(creator: Pick<PersonFacts, "role">): boolean { return creator.role === "SUPER_ADMIN"; }

/** Jumlah hari kerja (Sen–Jum) yang telah berlalu antara dua instan, dihitung per tanggal kalender di zona waktu yang diberikan. */
export function workingDaysElapsed(from: Date, to: Date, timeZone = "Asia/Jakarta"): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const day = (d: Date) => { const [y, m, dd] = fmt.format(d).split("-").map(Number); return Date.UTC(y!, m! - 1, dd!); };
  let cur = day(from); const end = day(to); let n = 0;
  while (cur < end) { cur += 86_400_000; const dow = new Date(cur).getUTCDay(); if (dow !== 0 && dow !== 6) n++; }
  return n;
}

/** Direktur boleh mengambil alih tinjauan setelah `days` hari kerja sejak diajukan. */
export function canTakeOver(submittedAt: Date | null, now: Date, days: number, timeZone?: string): boolean {
  return !!submittedAt && workingDaysElapsed(submittedAt, now, timeZone) >= days;
}

export const verifyPath = (token: string): string => `/verifikasi/${token}`;

/** Pemegang gambar tanda tangan pribadi: Direktur, Supervisor/Manajer, atau HR (calon penandatangan). */
export const canHoldSignature = (p: Pick<PersonFacts, "role" | "jobLevel" | "isIntern" | "isActive">): boolean =>
  p.isActive && !p.isIntern && (p.role === "SUPER_ADMIN" || p.role === "HR_ADMIN" || p.jobLevel === "MANAGER" || p.jobLevel === "SUPERVISOR");
