import { readBody, route } from "@/server/http";
import { updateUser } from "@/server/services/users";

export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateUser(actor, params.id, await readBody(req)));
