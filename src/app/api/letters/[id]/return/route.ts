import { readBody, route } from "@/server/http";
import { returnLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => returnLetter(actor, params.id, await readBody(req)));
