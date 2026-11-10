import { created, queryObject, readBody, route } from "@/server/http";
import { createLetter, listLetters } from "@/server/services/letters/documents";
export const GET = route(async ({ req, actor }) => {
  const q = queryObject(req);
  return listLetters(actor, { scope: q.scope as "mine" | "review" | "all" | undefined, status: q.status, q: q.q, page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined });
});
export const POST = route(async ({ req, actor }) => created(await createLetter(actor, await readBody(req))));
