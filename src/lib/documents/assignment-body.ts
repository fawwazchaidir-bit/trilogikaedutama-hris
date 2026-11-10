import { b, body, doc, labels, row, table } from "./builders";
import type { PmDoc } from "./content";
import { formatDateRange } from "@/lib/format";
import { tripDays } from "@/lib/assignment";
import { dayDate } from "./text";

/** Data penugasan terstruktur pada dokumen Surat Tugas (INT-002). Uang harian ada di sini tetapi TIDAK dicetak di surat. */
export interface AssignmentPayload {
  purpose: string; destination: string; startDate: string; endDate: string; details: string | null;
  assignees: { employeeId: string; dailyRate: number; days: number | null }[];
}
export interface AssigneeFacts { employeeId: string; name: string; employeeNo: string; position: string; division: string | null }

/** Isi Surat Tugas dibangkitkan dari data penugasan (bukan diketik) agar surat, uang harian, jadwal, dan ketersediaan tim selalu konsisten. */
export function buildAssignmentBody(a: AssignmentPayload, people: AssigneeFacts[]): PmDoc {
  const byId = new Map(people.map((x) => [x.employeeId, x]));
  const n = tripDays(a.startDate, a.endDate);
  const when = a.startDate === a.endDate ? dayDate(a.startDate) : formatDateRange(a.startDate, a.endDate);
  const rows = a.assignees.map((x, i) => {
    const f = byId.get(x.employeeId);
    return [String(i + 1), f?.name ?? "—", f?.employeeNo ?? "—", f?.position ?? "—", f?.division ?? "—"];
  });
  return doc(
    body("Yang bertanda tangan di bawah ini menugaskan kepada:"),
    table(["No.", "Nama", "No. Karyawan", "Jabatan", "Divisi"], rows, [8, 32, 18, 24, 18]),
    body("Untuk melaksanakan penugasan dengan rincian sebagai berikut:"),
    labels([
      row("Maksud / tujuan", [b(a.purpose)]),
      row("Lokasi", a.destination),
      row("Waktu", `${when} (${n} hari)`),
      ...(a.details ? [row("Uraian tugas", a.details)] : []),
    ], { indent: 1.25, labelWidth: 3.4 }),
    body("Surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab. Hasil pelaksanaan tugas dilaporkan kepada pemberi tugas setelah penugasan selesai."),
  );
}
