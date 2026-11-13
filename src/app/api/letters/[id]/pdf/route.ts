import { route } from "@/server/http";
import { letterPdf } from "@/server/services/letters/documents";

/**
 * PDF surat: pratinjau draf (watermark) atau berkas terbit. Ditampilkan inline di kerangka pratinjau.
 * Surat DIBATALKAN: salinan status bertanda DIBATALKAN (header `X-Document-Status: CANCELLED`); `?asli=1` meminta berkas ASLI arsip (tercatat di audit).
 */
export const GET = route<{ id: string }>(async ({ req, actor, params }) => {
  const original = new URL(req.url).searchParams.get("asli") === "1";
  const { bytes, name, cancelled, original: gotOriginal } = await letterPdf(actor, params.id, { original });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
      ...(cancelled ? { "X-Document-Status": gotOriginal ? "CANCELLED-ORIGINAL" : "CANCELLED" } : {}),
    },
  });
});
