import { readBody, route } from "@/server/http";
import { cancelSettlement } from "@/server/services/final-settlements";

/** Batalkan `{ reason }` (Draf/Menunggu oleh penyusun; Disetujui hanya pimpinan; Dibayar tidak dapat dibatalkan). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => cancelSettlement(actor, params.id, await readBody(req)));
