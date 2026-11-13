import { z } from "zod";
import { route } from "@/server/http";
import { Errors } from "@/server/errors";
import { assignmentPdfFile } from "@/server/services/assignments";

/**
 * Surat Tugas (PDF). Pengelola: semua; karyawan: hanya surat yang menugaskan dirinya.
 * Surat yang DIBATALKAN diunduh sebagai SALINAN STATUS bertanda DIBATALKAN (header `X-Document-Status: CANCELLED`); berkas asli tetap tersimpan sebagai arsip.
 */
export const GET = route<{ id: string }>(async ({ actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw Errors.notFound("Surat tugas");
  const f = await assignmentPdfFile(actor, id.data);
  return new Response(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${f.fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      ...(f.cancelled ? { "X-Document-Status": "CANCELLED" } : {}),
    },
  });
});
