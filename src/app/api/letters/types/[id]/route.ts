import { readBody, route } from "@/server/http";
import { updateTypePolicy } from "@/server/services/letters/types";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateTypePolicy(actor, params.id, await readBody(req)));
