import { route } from "@/server/http";
import { getTrainingDashboard } from "@/server/services/training/insights";
export const GET = route(async ({ actor }) => getTrainingDashboard(actor));
