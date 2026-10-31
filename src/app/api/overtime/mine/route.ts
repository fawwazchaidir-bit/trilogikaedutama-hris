import { route } from "@/server/http";
import { listMyOvertime } from "@/server/services/overtime";

export const GET = route(async ({ actor }) => listMyOvertime(actor));
