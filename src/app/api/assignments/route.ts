import { created, queryObject, readBody, route } from "@/server/http";
import { createAssignment, listAssignments } from "@/server/services/assignments";

export const GET = route(async ({ req, actor }) => listAssignments(actor, queryObject(req)));

/** Terbitkan Surat Tugas (HR / pimpinan) — dasar pemberian Uang Harian. */
export const POST = route(async ({ req, actor }) => created(await createAssignment(actor, await readBody(req))));
