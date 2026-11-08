import { route } from "@/server/http";
import { submitSettlement } from "@/server/services/final-settlements";

/** Ajukan untuk persetujuan (Draf → Menunggu persetujuan); wajib ada baris dan bersih tidak negatif. */
export const POST = route<{ id: string }>(async ({ actor, params }) => submitSettlement(actor, params.id));
