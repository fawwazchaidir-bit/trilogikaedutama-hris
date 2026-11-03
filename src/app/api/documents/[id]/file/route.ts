import { z } from "zod";
import { queryObject, route } from "@/server/http";
import { Errors } from "@/server/errors";
import { readDocumentFile } from "@/server/services/documents";

/**
 * PDF dokumen. Bawaan `inline` agar tampil di penampil PDF peramban (iframe aplikasi / tab baru); `?download=1` memaksa unduh.
 * Sengaja TANPA `Content-Security-Policy: sandbox` (yang membuat penampil PDF Chrome gagal); header keamanan global (frame-ancestors 'self',
 * X-Frame-Options SAMEORIGIN) tetap berlaku sehingga hanya halaman aplikasi ini yang dapat menyematkannya.
 */
export const GET = route<{ id: string }>(async ({ req, actor, params }) => {
  const id = z.string().uuid().safeParse(params.id);
  if (!id.success) throw Errors.notFound("Dokumen");
  const f = await readDocumentFile(actor, id.data);
  const download = queryObject(req).download === "1";
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(f.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${f.name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
});
