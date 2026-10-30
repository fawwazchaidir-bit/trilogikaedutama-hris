import { route } from "@/server/http";
import { getRun } from "@/server/services/payroll";

export const GET = route<{ id: string }>(async ({ actor, params }) => getRun(actor, params.id));
