import { z } from "zod";
import { queryObject, route } from "@/server/http";
import { Errors } from "@/server/errors";
import { auditPayslipAccess, getRunPayslips } from "@/server/services/payslips";
import { renderPayslipsPdf } from "@/server/pdf/render";
import { zipSync, strToU8 } from "fflate";

/** Unduh seluruh slip satu periode: `?format=pdf` (satu PDF, satu halaman per slip) atau `?format=zip` (satu PDF per karyawan). */
export const GET = route<{ id: string }>(async ({ req, actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw Errors.notFound("Periode penggajian");
  const format = queryObject(req).format === "zip" ? "zip" : "pdf";
  const slips = await getRunPayslips(actor, id.data);
  const label = slips[0]!.dto.periodLabel.replace(/[^0-9A-Za-z]+/g, "_");
  await auditPayslipAccess(actor, slips.map((s) => s.dto.id), `Seluruh slip periode "${slips[0]!.dto.periodLabel}" diunduh (${slips.length} slip, ${format})`);
  if (format === "pdf") {
    const pdf = await renderPayslipsPdf(slips.map((s) => ({ snapshot: s.snapshot, voided: s.voided })));
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Slip_Gaji_${label}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  const files: Record<string, Uint8Array> = {};
  for (const s of slips) {
    const pdf = await renderPayslipsPdf([{ snapshot: s.snapshot, voided: s.voided }]);
    files[`Slip_${s.dto.employeeNo}_${s.dto.employeeName.replace(/[^0-9A-Za-z]+/g, "_")}.pdf`] = new Uint8Array(pdf);
  }
  files["README.txt"] = strToU8(`Slip gaji periode ${slips[0]!.dto.periodLabel}. Dokumen rahasia — hanya untuk penerima.\n`);
  return new Response(new Uint8Array(zipSync(files, { level: 0 })), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Slip_Gaji_${label}.zip"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
