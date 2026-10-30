import { created, queryObject, readBody, route } from "@/server/http";
import { createComponent } from "@/server/services/components";
import { listComponents } from "@/server/services/components";
import { Errors } from "@/server/errors";

export const GET = route(async ({ req, actor }) => { const id = queryObject(req).employeeId; if (!id) throw Errors.badRequest("employeeId wajib diisi."); return listComponents(actor, id); });

export const POST = route(async ({ req, actor }) => created(await createComponent(actor, await readBody(req))));
