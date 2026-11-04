import { created, readBody, route } from "@/server/http";
import { addReadinessItem, listReadiness } from "@/server/services/training/indicator-data";
export const GET = route<{ id: string }>(async ({ actor, params }) => listReadiness(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addReadinessItem(actor, params.id, await readBody(req))));
