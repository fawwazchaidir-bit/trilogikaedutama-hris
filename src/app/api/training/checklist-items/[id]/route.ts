import { readBody, route } from "@/server/http";
import { deleteChecklistItem, updateChecklistItem } from "@/server/services/training/work";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateChecklistItem(actor, params.id, await readBody(req)); return null; });
/** Hapus item. Isi (mis. `{ reason }`) bersifat opsional: alasan hanya diwajibkan bila item itu WAJIB (divalidasi service). */
export const DELETE = route<{ id: string }>(async ({ req, actor, params }) => {
  await deleteChecklistItem(actor, params.id, req.headers.get("content-type") ? await readBody(req) : {});
  return null;
});
