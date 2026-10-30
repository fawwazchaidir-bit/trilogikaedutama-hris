import { readBody, route } from "@/server/http";
import { setComponentActive } from "@/server/services/components";
import { z } from "zod";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { const { active } = z.object({ active: z.boolean() }).parse(await readBody(req)); await setComponentActive(actor, params.id, active); return { ok: true }; });
