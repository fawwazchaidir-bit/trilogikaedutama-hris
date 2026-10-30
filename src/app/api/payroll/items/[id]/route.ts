import { route } from "@/server/http";
import { getItem } from "@/server/services/payroll";

export const GET = route<{ id: string }>(async ({ actor, params }) => getItem(actor, params.id));
