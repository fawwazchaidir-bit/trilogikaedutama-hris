import { readBody, route } from "@/server/http";
import { resetUserPassword } from "@/server/services/users";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await resetUserPassword(actor, params.id, await readBody(req)); return { ok: true }; });
