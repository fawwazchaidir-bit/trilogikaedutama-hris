import { route } from "@/server/http";
import { withdrawLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ actor, params }) => withdrawLetter(actor, params.id));
