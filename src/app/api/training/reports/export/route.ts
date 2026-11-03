import { queryObject, route } from "@/server/http";
import { tableResponse, TABLE_FORMATS, type TableFormat } from "@/server/export-response";
import { Errors } from "@/server/errors";
import { projectReportTable } from "@/server/services/training/insights";

export const GET = route(async ({ req, actor }) => {
  const q = queryObject(req);
  const format = (q.format ?? "xlsx") as TableFormat;
  if (!TABLE_FORMATS.includes(format)) throw Errors.badRequest("Format tidak didukung (csv, xlsx, pdf).");
  const { format: _f, ...filters } = q;
  return tableResponse(await projectReportTable(actor, filters), format, "Laporan_Proyek_Training", actor);
});
