import { readBody, route } from "@/server/http";
import { cancelRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => cancelRun(actor, params.id, await readBody(req)));
