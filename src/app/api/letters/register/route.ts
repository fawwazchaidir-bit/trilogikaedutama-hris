import { queryObject, route } from "@/server/http";
import { listRegister } from "@/server/services/letters/register";
export const GET = route(async ({ req, actor }) => listRegister(actor, queryObject(req)));
