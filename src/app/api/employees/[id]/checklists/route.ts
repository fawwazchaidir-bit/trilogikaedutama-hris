import { created, readBody, route } from "@/server/http";
import { listEmployeeChecklists, startChecklist } from "@/server/services/employee-checklists";

/** Checklist masuk/berhenti satu karyawan (dengan sinyal otomatis pada yang berjalan). HR. */
export const GET = route<{ id: string }>(async ({ actor, params }) => listEmployeeChecklists(actor, params.id));
/** Mulai checklist `{ kind: ONBOARDING | OFFBOARDING, targetDate?, note? }`; 409 bila yang sejenis masih berjalan. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await startChecklist(actor, params.id, await readBody(req))));
