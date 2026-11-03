import { z } from "zod";
import { route } from "@/server/http";
import { Errors } from "@/server/errors";
import { getReceiptForPdf } from "@/server/services/assignments";
import { renderReceiptPdf } from "@/server/pdf/render";

/** Bukti Penerimaan Uang Harian (PDF). Pengelola: semua; karyawan: hanya miliknya yang aktif. */
export const GET = route<{ id: string }>(async ({ actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw Errors.notFound("Bukti penerimaan");
  const r = await getReceiptForPdf(actor, id.data);
  const pdf = await renderReceiptPdf(r.snapshot, r.status === "VOIDED");
  const safe = `Bukti_Penerimaan_Uang_Harian_${r.number}`.replace(/[^0-9A-Za-z]+/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safe}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
