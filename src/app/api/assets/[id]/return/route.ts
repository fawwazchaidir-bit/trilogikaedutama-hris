import { readBody, route } from "@/server/http";
import { returnAsset } from "@/server/services/assets";

/** Catat pengembalian `{ condition: GOOD|DAMAGED|LOST, returnedOn?, note? }` — rusak/hilang wajib berketerangan; hilang → status Hilang. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => returnAsset(actor, params.id, await readBody(req)));
