import { readBody, route } from "@/server/http";
import { deleteLine, updateLine } from "@/server/services/final-settlements";

/** Ubah baris `{ category, name, amount, formula?, note? }` (hanya Draf); baris usulan sistem yang diubah menjadi manual. */
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateLine(actor, params.id, await readBody(req)));
/** Hapus baris (hanya Draf). */
export const DELETE = route<{ id: string }>(async ({ actor, params }) => deleteLine(actor, params.id));
