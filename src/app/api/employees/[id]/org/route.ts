import { readBody, route } from "@/server/http";
import { changeOrg, getOrgProfile, listOrgHistory } from "@/server/services/org";

/** Profil organisasi (divisi, jabatan, status, atasan langsung, tanggal berlaku, bawahan) + riwayat. HR, atau karyawan itu sendiri. */
export const GET = route<{ id: string }>(async ({ actor, params }) => ({ profile: await getOrgProfile(actor, params.id), history: await listOrgHistory(actor, params.id) }));
/** Ubah divisi/jabatan/status/atasan langsung dengan tanggal berlaku; riwayat dicatat otomatis. HR (employee:manage). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => changeOrg(actor, params.id, await readBody(req)));
