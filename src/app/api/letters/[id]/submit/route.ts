import { route } from "@/server/http";
import { submitLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ actor, params }) => submitLetter(actor, params.id));
