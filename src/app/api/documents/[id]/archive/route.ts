import { readBody, route } from "@/server/http";
import { archiveDocument } from "@/server/services/documents";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await archiveDocument(actor, params.id, await readBody(req)); return { ok: true }; });
