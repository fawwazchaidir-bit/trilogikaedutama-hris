import { route } from "@/server/http";
import { listStaffCapacity } from "@/server/services/training/indicator-data";
export const GET = route(async ({ actor }) => listStaffCapacity(actor));
