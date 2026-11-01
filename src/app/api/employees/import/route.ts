import { route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { readUpload } from "@/server/upload";
import { commitEmployeeImport, previewEmployeeImport, type ImportMode } from "@/server/services/employee-import";

/** Impor massal karyawan (xlsx/csv). `commit=1` menyimpan (atomik); tanpa itu hanya pratinjau validasi per baris. */
export const POST = route(async ({ req, actor }) => {
  assertCan(actor, "employee:import"); // izin diperiksa SEBELUM badan unggahan dibaca ke memori
  const { name, bytes, fields } = await readUpload(req);
  const mode: ImportMode = fields.mode === "update" ? "update" : "skip";
  return fields.commit === "1" ? commitEmployeeImport(actor, bytes, name, mode) : previewEmployeeImport(actor, bytes, name, mode);
});
