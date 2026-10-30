import { route } from "@/server/http";
import { listNotifications } from "@/server/services/notifications";

export const GET = route(async ({ actor }) => listNotifications(actor));
