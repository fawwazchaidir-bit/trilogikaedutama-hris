import { created, route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";
import { setSignature } from "@/server/services/settings";
import { normalizeSignature } from "@/server/photo/signature";
import { transaction } from "@/server/db";

/** Unggah gambar tanda tangan penanda tangan slip (Super Admin). Dinormalisasi server menjadi PNG ≤ 600×240. */
export const POST = route(async ({ req, actor }) => {
  assertCan(actor, "settings:manage"); // izin diperiksa SEBELUM badan unggahan dibaca ke memori
  const { bytes } = await readUpload(req);
  const png = await normalizeSignature(bytes);
  return created(await transaction(async (tx) => {
    const file = await storeFile(actor, "SIGNATURE", { name: "tanda-tangan.png", bytes: png }, tx);
    await setSignature(actor, file.id, tx);
    return file;
  }));
});

/** Cabut gambar tanda tangan (nama & jabatan penanda tangan tetap). */
export const DELETE = route(async ({ actor }) => { await setSignature(actor, null); return { ok: true }; });
