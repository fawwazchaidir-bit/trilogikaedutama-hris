import { route } from "@/server/http";
import { foundAsset } from "@/server/services/assets";

/** Aset yang tercatat hilang ditemukan kembali → tersedia. */
export const POST = route<{ id: string }>(async ({ actor, params }) => foundAsset(actor, params.id));
