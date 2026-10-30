import { readBody, route } from "@/server/http";
import { updateComponent } from "@/server/services/components";

export const PUT = route<{ id: string }>(async ({ req, actor, params }) => updateComponent(actor, params.id, await readBody(req)));
