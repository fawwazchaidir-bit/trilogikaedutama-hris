import { queryObject, route } from "@/server/http";
import { recapTable } from "@/server/services/recap";
import { tableResponse, TABLE_FORMATS, type TableFormat } from "@/server/export-response";
import { Errors } from "@/server/errors";

export const GET = route(async ({ req, actor }) => {
  const q = queryObject(req);
  const format = (q.format ?? "xlsx") as TableFormat;
  if (!TABLE_FORMATS.includes(format)) throw Errors.badRequest("Format tidak didukung (csv, xlsx, pdf).");
  const { format: _f, page: _p, pageSize: _s, ...filters } = q;
  return tableResponse(await recapTable(actor, filters), format, "Rekap_Absensi", actor);
});
