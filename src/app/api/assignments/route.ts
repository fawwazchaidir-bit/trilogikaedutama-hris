import { queryObject, route } from "@/server/http";
import { listAssignments } from "@/server/services/assignments";

export const GET = route(async ({ req, actor }) => listAssignments(actor, queryObject(req)));

// Pembuatan surat tugas tidak lagi lewat rute ini: gunakan Persuratan (POST /api/letters dengan jenis INT-002, lalu persetujuan penandatangan).
