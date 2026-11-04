import { route } from "@/server/http";
import { listProgramCards } from "@/server/services/training/indicator-compute";
export const GET = route(async ({ actor }) => listProgramCards(actor));
