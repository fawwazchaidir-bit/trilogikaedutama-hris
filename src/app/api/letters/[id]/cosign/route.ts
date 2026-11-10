import { route } from "@/server/http";
import { cosignLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ actor, params }) => cosignLetter(actor, params.id));
