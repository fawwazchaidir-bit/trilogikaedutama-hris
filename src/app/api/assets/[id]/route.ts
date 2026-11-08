import { readBody, route } from "@/server/http";
import { getAsset, updateAsset } from "@/server/services/assets";

/** Detail aset + riwayat serah-terimanya (HR). */
export const GET = route<{ id: string }>(async ({ actor, params }) => getAsset(actor, params.id));
/** Ubah data aset `{ name, category, serialNo?, note? }` (tidak untuk aset yang sudah dinonaktifkan). */
export const PUT = route<{ id: string }>(async ({ req, actor, params }) => updateAsset(actor, params.id, await readBody(req)));
