import { readBody, route } from "@/server/http";
import { getEmployee } from "@/server/services/employees";
import { updateEmployee } from "@/server/services/employees";

export const GET = route<{ id: string }>(async ({ actor, params }) => getEmployee(actor, params.id));

export const PUT = route<{ id: string }>(async ({ req, actor, params }) => updateEmployee(actor, params.id, await readBody(req)));
