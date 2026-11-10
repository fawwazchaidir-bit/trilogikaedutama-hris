import { created, route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";
import { setSignerSignature } from "@/server/services/letters/admin";
import { normalizeSignature } from "@/server/photo/signature";
import { transaction } from "@/server/db";

/** Unggah gambar tanda tangan penandatangan surat (Direktur). Dinormalisasi server menjadi PNG. */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  assertCan(actor, "settings:manage");
  const { bytes } = await readUpload(req);
  const png = await normalizeSignature(bytes);
  return created(await transaction(async (tx) => {
    const file = await storeFile(actor, "SIGNATURE", { name: "tanda-tangan.png", bytes: png }, tx);
    await setSignerSignature(actor, params.userId, file.id, tx);
    return file;
  }));
});
export const DELETE = route<{ userId: string }>(async ({ actor, params }) => { await setSignerSignature(actor, params.userId, null); return { ok: true }; });
