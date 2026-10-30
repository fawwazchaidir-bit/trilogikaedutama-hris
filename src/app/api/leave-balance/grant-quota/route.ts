import { readBody, route } from "@/server/http";
import { grantAnnualQuota } from "@/server/services/leave";

export const POST = route(async ({ req, actor }) => grantAnnualQuota(actor, await readBody(req)));
