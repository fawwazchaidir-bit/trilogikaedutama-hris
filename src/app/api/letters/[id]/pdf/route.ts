import { route } from "@/server/http";
import { letterPdf } from "@/server/services/letters/documents";

/** PDF surat: pratinjau draf (watermark) atau berkas terbit. Ditampilkan inline di kerangka pratinjau. */
export const GET = route<{ id: string }>(async ({ actor, params }) => {
  const { bytes, name } = await letterPdf(actor, params.id);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
});
