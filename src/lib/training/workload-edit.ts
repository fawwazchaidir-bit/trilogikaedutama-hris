/**
 * Dialog "Ubah jam & tanggal" baris jam kerja — validasi dan perbedaan nilai. Murni (tanpa DB/React): dipakai dialog dan diuji tersendiri.
 * Aturan server tetap berlaku (workloadUpdateSchema + pemeriksaan tanggal di updateWorkloadTask); ini umpan balik cepat di layar.
 */

export const WORKLOAD_HOURS_MAX = 2000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (s: string): boolean => { if (!ISO.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

export interface WorkloadEditInput { hours: string; startDate: string; endDate: string }
export interface WorkloadEditCurrent { hours: number; startDate: string; endDate: string }
export interface WorkloadEditResult {
  ok: boolean;
  errors: Partial<Record<"hours" | "startDate" | "endDate", string>>;
  /** Nilai terurai (hanya bila ok). */
  value: WorkloadEditCurrent | null;
  /** Bidang yang BERBEDA dari nilai sekarang (hanya yang dikirim ke server). Kosong = tidak ada perubahan. */
  patch: Partial<WorkloadEditCurrent>;
}

/** Jam: angka desimal (koma atau titik), > 0, ≤ 2000, paling banyak 2 angka di belakang koma. */
export function parseHours(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= WORKLOAD_HOURS_MAX ? n : null;
}

export function validateWorkloadEdit(input: WorkloadEditInput, current: WorkloadEditCurrent): WorkloadEditResult {
  const errors: WorkloadEditResult["errors"] = {};
  const hours = parseHours(input.hours);
  if (input.hours.trim() === "") errors.hours = "Jam wajib diisi";
  else if (hours === null) errors.hours = `Jam harus angka lebih dari 0 dan paling banyak ${WORKLOAD_HOURS_MAX} (maks. 2 angka di belakang koma)`;
  if (input.startDate === "") errors.startDate = "Tanggal mulai wajib diisi";
  else if (!validIso(input.startDate)) errors.startDate = "Tanggal mulai tidak valid";
  if (input.endDate === "") errors.endDate = "Tanggal selesai wajib diisi";
  else if (!validIso(input.endDate)) errors.endDate = "Tanggal selesai tidak valid";
  if (!errors.startDate && !errors.endDate && input.endDate < input.startDate) errors.endDate = "Tanggal selesai tidak boleh sebelum tanggal mulai";
  if (Object.keys(errors).length > 0 || hours === null) return { ok: false, errors, value: null, patch: {} };
  const patch: Partial<WorkloadEditCurrent> = {};
  if (Math.abs(hours - current.hours) > 1e-9) patch.hours = hours;
  if (input.startDate !== current.startDate) patch.startDate = input.startDate;
  if (input.endDate !== current.endDate) patch.endDate = input.endDate;
  return { ok: true, errors, value: { hours, startDate: input.startDate, endDate: input.endDate }, patch };
}
