import { readBody, route } from "@/server/http";
import { returnRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => returnRun(actor, params.id, await readBody(req)));
