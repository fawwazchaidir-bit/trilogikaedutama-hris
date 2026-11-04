import { route } from "@/server/http";
import { getProgramIndicators } from "@/server/services/training/indicator-compute";
export const GET = route<{ id: string }>(async ({ actor, params }) => getProgramIndicators(actor, params.id));
