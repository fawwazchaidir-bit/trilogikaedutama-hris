import { readBody, route } from "@/server/http";
import { checkOut } from "@/server/services/attendance";

export const POST = route(async ({ req, actor }) => checkOut(actor, await readBody(req)));
