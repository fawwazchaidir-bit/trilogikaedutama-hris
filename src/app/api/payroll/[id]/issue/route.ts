import { readBody, route } from "@/server/http";
import { issueRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => issueRun(actor, params.id, await readBody(req)));
