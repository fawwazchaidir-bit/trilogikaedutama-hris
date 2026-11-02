import { z } from "zod";
import { route } from "@/server/http";
import { Errors } from "@/server/errors";
import { getAssignmentForPdf } from "@/server/services/assignments";
import { renderAssignmentPdf } from "@/server/pdf/render";

/** Surat Tugas (PDF). Pengelola: semua; karyawan: hanya surat yang menugaskan dirinya. */
export const GET = route<{ id: string }>(async ({ actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw Errors.notFound("Surat tugas");
  const a = await getAssignmentForPdf(actor, id.data);
  const pdf = await renderAssignmentPdf(a.snapshot, a.status === "CANCELLED");
  const safe = `Surat_Tugas_${a.number}`.replace(/[^0-9A-Za-z]+/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safe}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
});
