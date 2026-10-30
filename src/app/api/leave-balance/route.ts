import { queryObject, readBody, route } from "@/server/http";
import { getBalance, getLedger } from "@/server/services/leave";
import { Errors } from "@/server/errors";
import { setBalance } from "@/server/services/leave";

export const GET = route(async ({ req, actor }) => { const q = queryObject(req); const employeeId = q.employeeId ?? actor.employeeId; if (!employeeId) throw Errors.badRequest("employeeId wajib diisi."); const year = q.year ? Number(q.year) : undefined; return { balance: await getBalance(actor, employeeId, year), ledger: await getLedger(actor, employeeId, year) }; });

export const POST = route(async ({ req, actor }) => setBalance(actor, await readBody(req)));
