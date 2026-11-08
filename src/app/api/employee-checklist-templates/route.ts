import { created, queryObject, readBody, route } from "@/server/http";
import { addTemplateItem, getTemplate, listAssignableUsers } from "@/server/services/employee-checklist-templates";

/** Template checklist `?kind=ONBOARDING|OFFBOARDING` (semua butir) + akun yang dapat dipilih sebagai penanggung jawab bawaan. HR. */
export const GET = route(async ({ req, actor }) => {
  const kind = (queryObject(req) as { kind?: string }).kind === "OFFBOARDING" ? "OFFBOARDING" : "ONBOARDING";
  return { kind, items: await getTemplate(actor, kind), users: await listAssignableUsers(actor) };
});
/** Tambah butir template `{ kind, title, hint?, group?, required?, dueOffsetDays?, defaultAssigneeId? }` — berlaku untuk checklist BARU. */
export const POST = route(async ({ req, actor }) => created(await addTemplateItem(actor, await readBody(req))));
