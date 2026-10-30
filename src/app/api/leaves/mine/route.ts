import { route } from "@/server/http";
import { listMyLeaves } from "@/server/services/leave";

export const GET = route(async ({ actor }) => listMyLeaves(actor));
