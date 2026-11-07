import { route } from "@/server/http";
import { listChecklistOverview } from "@/server/services/employee-checklists";

/** Semua proses masuk/berhenti: yang berjalan (terlambat dulu) dan yang baru ditutup. HR. */
export const GET = route(async ({ actor }) => listChecklistOverview(actor));
