import { readBody, route } from "@/server/http";
import { rejectLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => rejectLetter(actor, params.id, await readBody(req)));
