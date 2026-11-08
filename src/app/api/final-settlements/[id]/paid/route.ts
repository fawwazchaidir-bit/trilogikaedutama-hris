import { readBody, route } from "@/server/http";
import { markSettlementPaid } from "@/server/services/final-settlements";

/** Catat sudah dibayar `{ paidOn?, reference? }` (pembayaran dilakukan di luar aplikasi); terkunci setelahnya. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => markSettlementPaid(actor, params.id, await readBody(req).catch(() => ({}))));
