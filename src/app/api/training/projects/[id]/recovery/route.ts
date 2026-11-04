import { created, readBody, route } from "@/server/http";
import { addRecoveryNote, listRecoveryNotes } from "@/server/services/training/recovery";
export const GET = route<{ id: string }>(async ({ actor, params }) => listRecoveryNotes(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addRecoveryNote(actor, params.id, await readBody(req))));
