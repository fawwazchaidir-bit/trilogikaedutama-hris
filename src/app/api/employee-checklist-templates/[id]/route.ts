import { readBody, route } from "@/server/http";
import { updateTemplateItem } from "@/server/services/employee-checklist-templates";

/** Ubah butir template (judul, keterangan, wajib, tenggat, penanggung jawab bawaan, aktif). Tidak memengaruhi checklist yang sudah berjalan. */
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateTemplateItem(actor, params.id, await readBody(req)); return { ok: true }; });
