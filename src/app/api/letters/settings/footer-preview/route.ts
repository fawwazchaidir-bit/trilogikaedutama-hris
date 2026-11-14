import { readBody, route } from "@/server/http";
import { previewFooterPdf } from "@/server/services/letters/admin";

/** Pratinjau PDF kaki halaman (dua halaman contoh) dengan konfigurasi yang sedang disunting. Hanya Direktur; tidak menyimpan apa pun. */
export const POST = route(async ({ req, actor }) => {
  const bytes = await previewFooterPdf(actor, await readBody(req));
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="pratinjau-kaki-halaman.pdf"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
});
