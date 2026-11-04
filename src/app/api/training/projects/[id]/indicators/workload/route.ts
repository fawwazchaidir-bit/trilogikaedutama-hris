import { route } from "@/server/http";
import { regenerateProjectWorkload } from "@/server/services/training/indicator-data";
export const POST = route<{ id: string }>(async ({ actor, params }) => regenerateProjectWorkload(actor, params.id));
