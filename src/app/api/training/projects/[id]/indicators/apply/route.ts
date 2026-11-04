import { created, route } from "@/server/http";
import { applyIndicatorTemplates } from "@/server/services/training/indicator-data";
export const POST = route<{ id: string }>(async ({ actor, params }) => created(await applyIndicatorTemplates(actor, params.id)));
