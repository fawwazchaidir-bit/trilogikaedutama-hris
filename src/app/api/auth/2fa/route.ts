import { cookies } from "next/headers";
import { publicRoute, readBody } from "@/server/http";
import { completeLogin } from "@/server/services/auth";
import { cookieOptions, SESSION_COOKIE_NAME } from "@/server/auth/session";

export const POST = publicRoute(async ({ req, meta }) => {
  const r = await completeLogin(await readBody(req), meta);
  (await cookies()).set(SESSION_COOKIE_NAME(), r.token, cookieOptions(r.expiresAt));
  return { user: r.user };
});
