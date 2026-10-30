import { route } from "@/server/http";
import { getTodayState } from "@/server/services/attendance";

export const GET = route(async ({ actor }) => getTodayState(actor));
