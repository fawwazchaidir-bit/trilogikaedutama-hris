import { readBody, route } from "@/server/http";
import { approveSettlement } from "@/server/services/final-settlements";

/** Pimpinan menyetujui `{ note? }`; tidak boleh menyetujui penyelesaian miliknya sendiri. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => approveSettlement(actor, params.id, await readBody(req).catch(() => ({}))));
