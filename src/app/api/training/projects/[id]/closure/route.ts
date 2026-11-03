import { route } from "@/server/http";
import { getClosurePreview } from "@/server/services/training/insights";
export const GET = route<{ id: string }>(async ({ actor, params }) => getClosurePreview(actor, params.id));
