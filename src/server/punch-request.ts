import "server-only";
import { env } from "./env";
import { Errors } from "./errors";
import { readBody } from "./http";

/**
 * Isi permintaan check-in/out. Dua bentuk:
 *  - JSON biasa (tanpa foto), atau
 *  - multipart/form-data: bidang `payload` (JSON string: catatan & lokasi) + `photo` (berkas foto dari kamera).
 * Ukuran diperiksa sebelum dibaca ke memori.
 */
export async function readPunchRequest(req: Request): Promise<{ body: unknown; photo: Uint8Array | null }> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.includes("multipart/form-data")) return { body: await readBody(req), photo: null };
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes + 128 * 1024) throw Errors.validation(`Ukuran foto maksimal ${env().MAX_UPLOAD_MB} MB.`, { photo: "Foto terlalu besar" });
  let form: FormData;
  try { form = await req.formData(); } catch { throw Errors.badRequest("Form absensi tidak valid."); }
  let body: unknown = {};
  const payload = form.get("payload");
  if (typeof payload === "string" && payload.trim() !== "") {
    if (payload.length > 20_000) throw Errors.badRequest("Isi permintaan terlalu besar.");
    try { body = JSON.parse(payload); } catch { throw Errors.badRequest("JSON tidak valid."); }
  }
  const file = form.get("photo");
  let photo: Uint8Array | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > maxBytes) throw Errors.validation(`Ukuran foto maksimal ${env().MAX_UPLOAD_MB} MB.`, { photo: "Foto terlalu besar" });
    photo = new Uint8Array(await file.arrayBuffer());
  }
  return { body, photo };
}
