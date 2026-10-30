import ExcelJS from "exceljs";
import { route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { IMPORT_TEMPLATE_HEADERS, IMPORT_TEMPLATE_ROWS } from "@/server/services/employee-import";

/** Templat impor (.xlsx) dengan dua baris contoh FIKTIF. */
export const GET = route(async ({ actor }) => {
  assertCan(actor, "employee:import");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Karyawan");
  const head = ws.addRow(IMPORT_TEMPLATE_HEADERS);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE0E0" } }; });
  for (const r of IMPORT_TEMPLATE_ROWS) ws.addRow(r);
  IMPORT_TEMPLATE_HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(14, h.length + 4); ws.getColumn(i + 1).numFmt = "@"; });
  const guide = wb.addWorksheet("Petunjuk");
  [
    "Kolom wajib: No. Induk, Nama Lengkap, Jabatan, Mulai Bekerja.",
    "Status: Tetap / Kontrak / Magang (kosong = Tetap).",
    "Mulai Bekerja: YYYY-MM-DD atau DD/MM/YYYY.",
    "Divisi yang belum ada akan dibuat otomatis.",
    "Nomor rekening disimpan terenkripsi dan hanya tampil 4 digit terakhir.",
    "Hapus dua baris contoh sebelum mengunggah. Maksimal 500 baris.",
  ].forEach((t) => guide.addRow([t]));
  guide.getColumn(1).width = 90;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Templat_Impor_Karyawan.xlsx"', "Cache-Control": "private, no-store",
    },
  });
});
