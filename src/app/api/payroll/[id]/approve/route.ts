import { readBody, route } from "@/server/http";
import { approveRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => approveRun(actor, params.id, await readBody(req)));
