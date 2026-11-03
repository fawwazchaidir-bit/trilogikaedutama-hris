import { readBody, route } from "@/server/http";
import { getLeavePolicy, setLeavePolicy } from "@/server/services/leave";

/** Kebijakan cuti efektif satu karyawan (karyawan sendiri atau peninjau). */
export const GET = route<{ id: string }>(async ({ actor, params }) => getLeavePolicy(actor, params.id));

/** Atur kebijakan cuti KHUSUS karyawan ini (null = ikut bawaan). */
export const PUT = route<{ id: string }>(async ({ req, actor, params }) => setLeavePolicy(actor, params.id, await readBody(req)));
