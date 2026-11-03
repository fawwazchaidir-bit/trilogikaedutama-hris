import { route } from "@/server/http";
import { deleteDocument } from "@/server/services/training/operations";
export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await deleteDocument(actor, params.id); return null; });
