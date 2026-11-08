import { readBody, route } from "@/server/http";
import { retireAsset } from "@/server/services/assets";

/** Nonaktifkan aset `{ reason }` (tersedia/hilang saja; terminal, tidak dihapus). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => retireAsset(actor, params.id, await readBody(req)));
