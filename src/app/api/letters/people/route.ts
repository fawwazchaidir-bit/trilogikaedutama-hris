import { route } from "@/server/http";
import { listCoSignerCandidates } from "@/server/services/letters/types";
export const GET = route(async ({ actor }) => listCoSignerCandidates(actor));
