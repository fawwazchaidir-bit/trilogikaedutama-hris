import { created, queryObject, readBody, route } from "@/server/http";
import { addCalendarDay } from "@/server/services/schedules";
import { listCalendar } from "@/server/services/schedules";

export const GET = route(async ({ req, actor }) => listCalendar(actor, Number(queryObject(req).year ?? new Date().getFullYear())));

export const POST = route(async ({ req, actor }) => { await addCalendarDay(actor, await readBody(req)); return created({ ok: true }); });
