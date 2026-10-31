import { cookies } from "next/headers";
import { z } from "zod";
import { publicRoute, readJson } from "@/server/http";
import { startLogin } from "@/server/services/auth";
import { cookieOptions, SESSION_COOKIE_NAME } from "@/server/auth/session";

const schema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi").max(200),
  password: z.string().min(1, "Password wajib diisi").max(256),
});

export const POST = publicRoute(async ({ req, meta }) => {
  const input = await readJson(req, schema);
  const r = await startLogin(input, meta);
  // Akun ber-2FA: tidak ada sesi/cookie sampai kode diverifikasi (POST /api/auth/2fa).
  if (r.requiresTwoFactor) return { requiresTwoFactor: true, challenge: r.challenge, expiresAt: r.challengeExpiresAt };
  (await cookies()).set(SESSION_COOKIE_NAME(), r.token, cookieOptions(r.expiresAt));
  return { requiresTwoFactor: false, user: r.user };
});
