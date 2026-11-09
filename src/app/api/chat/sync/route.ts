import { route } from "@/server/http";
import { getSync } from "@/server/services/chat/rooms";
export const GET = route(async ({ actor }) => getSync(actor));
