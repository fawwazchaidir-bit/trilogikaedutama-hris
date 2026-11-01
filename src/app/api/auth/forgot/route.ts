import { publicRoute, readBody } from "@/server/http";
import { requestPasswordReset } from "@/server/services/password-reset";

export const POST = publicRoute(async ({ req, meta }) => requestPasswordReset(await readBody(req), meta));
