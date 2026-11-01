import { z } from "zod";
import { route, queryObject } from "@/server/http";
import { tableResponse, TABLE_FORMATS, type TableFormat } from "@/server/export-response";
import { reportTable, REPORT_KINDS, type ReportKind } from "@/server/services/reports";
import { Errors } from "@/server/errors";

const schema = z.object({ kind: z.enum(REPORT_KINDS), format: z.enum(TABLE_FORMATS).default("xlsx") });

/** GET /api/reports/export?kind=kehadiran|cuti-lembur|biaya|kepatuhan|karyawan&format=csv|xlsx|pdf&month=YYYY-MM|from=&to=|year= */
export const GET = route(async ({ req, actor }) => {
  const q = queryObject(req);
  const p = schema.safeParse(q);
  if (!p.success) throw Errors.validation("Jenis atau format laporan tidak dikenal.");
  const { kind, format } = p.data;
  return tableResponse(await reportTable(actor, kind as ReportKind, q), format as TableFormat, kind, actor);
});
