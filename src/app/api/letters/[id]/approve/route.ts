import { route } from "@/server/http";
import { approveLetter } from "@/server/services/letters/documents";
export const POST = route<{ id: string }>(async ({ actor, params }) => approveLetter(actor, params.id));
