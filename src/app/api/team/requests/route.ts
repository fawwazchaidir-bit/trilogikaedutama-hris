import { queryObject, route } from "@/server/http";
import { listTeamLeaves } from "@/server/services/leave";
import { listTeamOvertime } from "@/server/services/overtime";

/** Pengajuan cuti & lembur tim yang boleh ditinjau pelaku (atasan langsung, pengganti, atau eskalasi). Bukan atasan → 403. */
export const GET = route(async ({ req, actor }) => {
  const q = queryObject(req);
  const [leaves, overtime] = await Promise.all([listTeamLeaves(actor, q), listTeamOvertime(actor, q)]);
  return { leaves: leaves.items, overtime: overtime.items, capacity: leaves.capacity };
});
