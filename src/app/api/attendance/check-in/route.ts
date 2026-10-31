import { readBody, route } from "@/server/http";
import { deviceToken } from "@/server/http-device";
import { checkIn } from "@/server/services/attendance";

export const POST = route(async ({ req, actor, meta }) => checkIn(actor, await readBody(req), new Date(), { ip: meta.ip, deviceToken: await deviceToken() }));
