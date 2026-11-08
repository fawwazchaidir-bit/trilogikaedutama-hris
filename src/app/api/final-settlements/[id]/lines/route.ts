import { created, readBody, route } from "@/server/http";
import { addLine } from "@/server/services/final-settlements";

/** Tambah baris manual `{ category, name, amount, formula?, note? }` — pesangon, UPMK, UPH, THR, pajak, kasbon, dll. diisi di sini (hanya Draf). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addLine(actor, params.id, await readBody(req))));
