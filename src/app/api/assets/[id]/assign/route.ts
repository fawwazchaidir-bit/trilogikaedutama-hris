import { readBody, route } from "@/server/http";
import { assignAsset } from "@/server/services/assets";

/** Serahkan aset ke karyawan aktif `{ employeeId, assignedOn?, note? }`; 409 bila aset tidak tersedia. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => assignAsset(actor, params.id, await readBody(req)));
