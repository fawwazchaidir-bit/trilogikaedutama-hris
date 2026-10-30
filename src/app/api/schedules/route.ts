import { created, readBody, route } from "@/server/http";
import { createSchedule } from "@/server/services/schedules";
import { listSchedules } from "@/server/services/schedules";

export const GET = route(async ({ actor }) => listSchedules(actor));

export const POST = route(async ({ req, actor }) => created(await createSchedule(actor, await readBody(req))));
