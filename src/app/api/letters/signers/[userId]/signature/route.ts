import { created, route } from "@/server/http";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";
import { assertCanSetSignature, setSignerSignature } from "@/server/services/letters/admin";
import { normalizeSignature } from "@/server/photo/signature";
import { transaction } from "@/server/db";

const target = (userId: string, me: string) => (userId === "me" ? me : userId);

/** Unggah gambar tanda tangan penandatangan surat: Direktur untuk siapa saja, atau pemilik akun sendiri (`/signers/me/signature`). Dinormalisasi server menjadi PNG. */
export const POST = route<{ userId: string }>(async ({ req, actor, params }) => {
  const uid = target(params.userId, actor.userId);
  await assertCanSetSignature(actor, uid); // izin diperiksa SEBELUM badan unggahan dibaca ke memori
  const { bytes } = await readUpload(req);
  const png = await normalizeSignature(bytes);
  return created(await transaction(async (tx) => {
    const file = await storeFile(actor, "LETTER_SIGNATURE", { name: "tanda-tangan.png", bytes: png }, tx);
    await setSignerSignature(actor, uid, file.id, tx);
    return file;
  }));
});
export const DELETE = route<{ userId: string }>(async ({ actor, params }) => { await setSignerSignature(actor, target(params.userId, actor.userId), null); return { ok: true }; });
