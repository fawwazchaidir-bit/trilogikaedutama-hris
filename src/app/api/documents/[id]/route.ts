import { route } from "@/server/http";
import { getDocument } from "@/server/services/documents";

export const GET = route<{ id: string }>(async ({ actor, params }) => getDocument(actor, params.id));
