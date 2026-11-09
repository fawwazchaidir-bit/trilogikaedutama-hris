import { route } from "@/server/http";
import { listRefOptions } from "@/server/services/chat/messages";
export const GET = route(async ({ actor }) => listRefOptions(actor));
