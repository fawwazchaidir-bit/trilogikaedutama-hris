import { readBody, route } from "@/server/http";
import { markRead } from "@/server/services/notifications";
import { z } from "zod";

export const POST = route(async ({ req, actor }) => { const { ids } = z.object({ ids: z.array(z.string().regex(/^\d{1,18}$/)).max(200).optional() }).parse(await readBody(req)); await markRead(actor, ids); return { ok: true }; });
