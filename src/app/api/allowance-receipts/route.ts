import { created, readBody, route } from "@/server/http";
import { issueReceipt } from "@/server/services/assignments";

/** Terbitkan Bukti Penerimaan Uang Harian untuk satu penerima tugas (berdiri sendiri, di luar slip gaji). */
export const POST = route(async ({ req, actor }) => created(await issueReceipt(actor, await readBody(req))));
