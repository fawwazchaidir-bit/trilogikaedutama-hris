import { readBody, route } from "@/server/http";
import { sendTestNotification } from "@/server/services/account";

export const POST = route(async ({ req, actor }) => sendTestNotification(actor, await readBody(req)));
