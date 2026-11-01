import { publicRoute, readBody } from "@/server/http";
import { inspectResetToken, resetPassword } from "@/server/services/password-reset";

/** Periksa tautan: { valid, needsTwoFactor } — untuk menampilkan formulir yang tepat. */
export const GET = publicRoute(async ({ req }) => inspectResetToken(new URL(req.url).searchParams.get("token") ?? ""));

export const POST = publicRoute(async ({ req, meta }) => { await resetPassword(await readBody(req), meta); return { ok: true }; });
