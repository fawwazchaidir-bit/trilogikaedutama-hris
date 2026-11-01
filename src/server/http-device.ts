import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isSecureDeployment } from "./env";

/**
 * Token perangkat: cookie HttpOnly acak yang dipasang server pada punch pertama. Dipakai sebagai SINYAL (perangkat baru /
 * dipakai bergantian karyawan lain) — bukan otentikasi. Menghapus cookie hanya membuat perangkat tampak "baru".
 */
export const DEVICE_COOKIE_NAME = () => (isSecureDeployment() ? "__Host-hris_device" : "hris_device");

export async function deviceToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(DEVICE_COOKIE_NAME())?.value;
  if (existing && existing.length >= 20 && existing.length <= 100) return existing;
  const token = randomBytes(24).toString("base64url");
  store.set(DEVICE_COOKIE_NAME(), token, { httpOnly: true, secure: isSecureDeployment(), sameSite: "lax", path: "/", maxAge: 400 * 86_400 });
  return token;
}
