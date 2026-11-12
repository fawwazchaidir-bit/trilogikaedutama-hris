import { readBody, route } from "@/server/http";
import { reviewWorkloadRow } from "@/server/services/training/indicator-data";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await reviewWorkloadRow(actor, params.id, await readBody(req)); return { ok: true }; });
