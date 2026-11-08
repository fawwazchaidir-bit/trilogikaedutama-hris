import { created, queryObject, readBody, route } from "@/server/http";
import { createAsset, listAssets } from "@/server/services/assets";

/** Daftar aset `?status=&category=&q=` (HR). */
export const GET = route(async ({ req, actor }) => listAssets(actor, queryObject(req)));
/** Daftarkan aset `{ name, category, serialNo?, note? }` — kode "AST-0001" dibuat sistem. */
export const POST = route(async ({ req, actor }) => created(await createAsset(actor, await readBody(req))));
