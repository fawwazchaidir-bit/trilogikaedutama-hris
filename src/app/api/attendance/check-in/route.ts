import { route } from "@/server/http";
import { deviceToken } from "@/server/http-device";
import { readPunchRequest } from "@/server/punch-request";
import { checkIn } from "@/server/services/attendance";

/** JSON biasa, atau multipart (`payload` + `photo`) bila memakai foto absensi. */
export const POST = route(async ({ req, actor, meta }) => {
  const { body, photo } = await readPunchRequest(req);
  return checkIn(actor, body, new Date(), { ip: meta.ip, deviceToken: await deviceToken(), photo });
});
