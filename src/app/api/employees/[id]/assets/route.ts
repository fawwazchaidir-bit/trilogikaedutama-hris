import { route } from "@/server/http";
import { listEmployeeAssets } from "@/server/services/assets";

/** Aset yang sedang dipegang satu karyawan + riwayatnya (HR). */
export const GET = route<{ id: string }>(async ({ actor, params }) => listEmployeeAssets(actor, params.id));
