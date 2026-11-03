import { queryObject, route } from "@/server/http";
import { listProjectActivity } from "@/server/services/training/insights";
export const GET = route<{ id: string }>(async ({ req, actor, params }) => listProjectActivity(actor, params.id, Number(queryObject(req).page) || 1));
