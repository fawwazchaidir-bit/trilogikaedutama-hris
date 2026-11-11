import { readBody, route } from "@/server/http";
import { deactivateEmployee } from "@/server/services/employees";

/** Nonaktifkan karyawan. Hasil memuat daftar serah terima Training (yang masih dipegang karyawan itu); rincian disesuaikan hak lihat pelaku. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => ({ ok: true, ...(await deactivateEmployee(actor, params.id, await readBody(req))) }));
