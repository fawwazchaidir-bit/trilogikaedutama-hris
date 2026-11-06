import { queryObject, route } from "@/server/http";
import { getTeamAvailability } from "@/server/services/availability";

/** Ketersediaan tim per orang per hari (penugasan/surat tugas, cuti, libur). HR/Super Admin dan pemegang level modul Training; selain itu 403. */
export const GET = route(async ({ req, actor }) => getTeamAvailability(actor, queryObject(req)));
