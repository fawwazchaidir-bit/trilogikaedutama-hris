import { z } from "zod";
import { route } from "@/server/http";
import { Errors } from "@/server/errors";
import { auditPayslipAccess, getPayslip } from "@/server/services/payslips";
import { renderPayslipsPdf } from "@/server/pdf/render";

/** Slip satu karyawan (PDF). Karyawan hanya dapat mengunduh slip miliknya yang aktif; admin semua. */
export const GET = route<{ id: string }>(async ({ actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw Errors.notFound("Slip gaji");
  const { dto, snapshot } = await getPayslip(actor, id.data);
  const pdf = await renderPayslipsPdf([{ snapshot, voided: dto.status === "VOIDED" }]);
  await auditPayslipAccess(actor, [dto.id], `Slip ${dto.number} (${dto.employeeName}) diunduh`);
  const safe = `Slip_Gaji_${dto.employeeNo}_${dto.periodLabel}`.replace(/[^0-9A-Za-z]+/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safe}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
