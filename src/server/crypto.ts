import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * Enkripsi field sensitif (nomor rekening) dengan AES-256-GCM. Format tersimpan: `v1:<iv>:<tag>:<ciphertext>` (base64url).
 * Awalan versi memungkinkan rotasi kunci di masa depan tanpa memutus data lama. Integritas dijamin tag GCM:
 * data yang diubah di database akan gagal didekripsi (bukan menghasilkan nilai palsu).
 */
const key = () => Buffer.from(env().DATA_ENCRYPTION_KEY, "base64");

export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptField(stored: string): string {
  const [v, iv, tag, ct] = stored.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Format data terenkripsi tidak dikenali");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
