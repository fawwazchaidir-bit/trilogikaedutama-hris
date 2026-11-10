import { created, route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";
import { setStamp } from "@/server/services/letters/admin";
import { normalizeSignature } from "@/server/photo/signature";
import { transaction } from "@/server/db";

/** Unggah gambar cap lembaga untuk surat (Direktur). */
export const POST = route(async ({ req, actor }) => {
  assertCan(actor, "settings:manage");
  const { bytes } = await readUpload(req);
  const png = await normalizeSignature(bytes);
  return created(await transaction(async (tx) => {
    const file = await storeFile(actor, "SIGNATURE", { name: "cap.png", bytes: png }, tx);
    await setStamp(actor, file.id, tx);
    return file;
  }));
});
export const DELETE = route(async ({ actor }) => { await setStamp(actor, null); return { ok: true }; });
