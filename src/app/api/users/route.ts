import { created, readBody, route } from "@/server/http";
import { createUser } from "@/server/services/users";
import { listUsers } from "@/server/services/users";

export const GET = route(async ({ actor }) => listUsers(actor));

export const POST = route(async ({ req, actor }) => created(await createUser(actor, await readBody(req))));
