import { route } from "@/server/http";
import { deleteCalendarDay } from "@/server/services/schedules";

export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await deleteCalendarDay(actor, params.id); return { ok: true }; });
