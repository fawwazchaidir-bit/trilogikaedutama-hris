import { readBody, route } from "@/server/http";
import { decideRenewal } from "@/server/services/documents";

/** Keputusan pimpinan atas kontrak: lanjutkan / tidak lanjutkan (Super Admin). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => decideRenewal(actor, params.id, await readBody(req)));
