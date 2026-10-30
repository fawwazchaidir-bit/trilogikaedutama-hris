import { readBody, route } from "@/server/http";
import { checkIn } from "@/server/services/attendance";

export const POST = route(async ({ req, actor }) => checkIn(actor, await readBody(req)));
