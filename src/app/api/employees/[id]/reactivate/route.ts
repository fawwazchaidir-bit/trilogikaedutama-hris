import { route } from "@/server/http";
import { reactivateEmployee } from "@/server/services/employees";

/** Aktifkan kembali karyawan; akun login ikut aktif hanya untuk peran Karyawan (`account` menjelaskan hasilnya). */
export const POST = route<{ id: string }>(async ({ actor, params }) => ({ ok: true, ...(await reactivateEmployee(actor, params.id)) }));
