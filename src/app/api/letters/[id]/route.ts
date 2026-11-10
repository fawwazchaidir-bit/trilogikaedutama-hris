import { readBody, route } from "@/server/http";
import { getLetter, updateLetter } from "@/server/services/letters/documents";
export const GET = route<{ id: string }>(async ({ actor, params }) => getLetter(actor, params.id));
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateLetter(actor, params.id, await readBody(req)));
