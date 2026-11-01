import { readBody, route } from "@/server/http";
import { updateNotificationPrefs } from "@/server/services/account";

export const PUT = route(async ({ req, actor }) => updateNotificationPrefs(actor, await readBody(req)));
