import { readBody, route } from "@/server/http";
import { createRevision } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => createRevision(actor, params.id, await readBody(req)));
