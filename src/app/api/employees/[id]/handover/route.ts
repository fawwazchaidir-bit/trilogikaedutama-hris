import { route } from "@/server/http";
import { getEmployeeHandover } from "@/server/services/training/handover";

/** Daftar serah terima Training karyawan (yang masih dipegang: tugas, checklist, milestone, kesiapan, keanggotaan). Pengelola karyawan atau pengguna modul Training. */
export const GET = route<{ id: string }>(async ({ actor, params }) => getEmployeeHandover(actor, params.id));
