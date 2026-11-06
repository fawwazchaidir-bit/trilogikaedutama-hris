import { queryObject, readBody, route } from "@/server/http";
import { createDelegation, listDelegateCandidates, listDelegations } from "@/server/services/org";

/** Penunjukan pengganti peninjau yang berlaku/akan datang (+ calon pengganti). `?supervisorId=` hanya untuk diri sendiri atau HR. */
export const GET = route(async ({ req, actor }) => {
  const { supervisorId } = queryObject(req) as { supervisorId?: string };
  return { items: await listDelegations(actor, { supervisorId }), candidates: await listDelegateCandidates(actor, supervisorId) };
});
export const POST = route(async ({ req, actor }) => createDelegation(actor, await readBody(req)));
