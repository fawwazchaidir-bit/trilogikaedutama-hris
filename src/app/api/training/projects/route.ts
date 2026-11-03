import { created, queryObject, readBody, route } from "@/server/http";

import { createProject, listProjects } from "@/server/services/training/projects";
export const GET = route(async ({ req, actor }) => listProjects(actor, queryObject(req)));
export const POST = route(async ({ req, actor }) => created(await createProject(actor, await readBody(req))));
