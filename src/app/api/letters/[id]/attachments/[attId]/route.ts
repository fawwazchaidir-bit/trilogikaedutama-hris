import { readBody, route } from "@/server/http";
import { deleteAttachment, updateAttachment } from "@/server/services/letters/attachments";
export const PATCH = route<{ id: string; attId: string }>(async ({ req, actor, params }) => updateAttachment(actor, params.id, params.attId, await readBody(req)));
export const DELETE = route<{ id: string; attId: string }>(async ({ actor, params }) => { await deleteAttachment(actor, params.id, params.attId); return { ok: true }; });
