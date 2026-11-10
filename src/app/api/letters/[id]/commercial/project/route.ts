import { readBody, route } from "@/server/http";
import { createProjectFromLetter } from "@/server/services/letters/commercial";
/** Buat proyek in-house dari penawaran Deal (atau tautkan ke proyek yang ada: `{existingProjectId}`). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => createProjectFromLetter(actor, params.id, await readBody(req).catch(() => ({}))));
