import { queryObject, route } from "@/server/http";
import { employeesTable } from "@/server/services/employees";
import { tableResponse, TABLE_FORMATS, type TableFormat } from "@/server/export-response";
import { Errors } from "@/server/errors";

export const GET = route(async ({ req, actor }) => {
  const q = queryObject(req);
  const format = (q.format ?? "xlsx") as TableFormat;
  if (!TABLE_FORMATS.includes(format)) throw Errors.badRequest("Format tidak didukung (csv, xlsx, pdf).");
  const { format: _f, ...filters } = q;
  return tableResponse(await employeesTable(actor, filters), format, "Karyawan", actor);
});
