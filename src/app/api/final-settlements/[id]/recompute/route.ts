import { route } from "@/server/http";
import { recomputeSettlement } from "@/server/services/final-settlements";

/** Hitung ulang usulan sistem dari data terkini (hanya Draf; baris manual tidak berubah). */
export const POST = route<{ id: string }>(async ({ actor, params }) => recomputeSettlement(actor, params.id));
