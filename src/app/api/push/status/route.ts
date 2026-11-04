import { route } from "@/server/http";
import { getPushStatus } from "@/server/services/push";
export const GET = route(async ({ actor }) => getPushStatus(actor));
