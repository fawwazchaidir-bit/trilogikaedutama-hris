import { queryObject, route } from "@/server/http";
import { Errors } from "@/server/errors";
import { listSigners } from "@/server/services/letters/types";
export const GET = route(async ({ req, actor }) => {
  const { typeId } = queryObject(req);
  if (!typeId) throw Errors.badRequest("typeId wajib diisi.");
  return listSigners(actor, typeId);
});
