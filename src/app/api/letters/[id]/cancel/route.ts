import { readBody, route } from "@/server/http";
import { cancelLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => cancelLetter(actor, params.id, await readBody(req)));
