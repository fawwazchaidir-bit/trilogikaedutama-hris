/**
 * Siapa berwenang meninjau pengajuan seorang karyawan — FUNGSI MURNI (tanpa database) agar dapat diuji menyeluruh.
 * Dipakai oleh layanan cuti/lembur untuk memutuskan (a) boleh/tidaknya seseorang menyetujui, (b) siapa yang diberi tahu saat pengajuan masuk,
 * dan (c) pengajuan milik siapa yang tampil pada halaman "Persetujuan Tim".
 *
 * Aturan sederhana (tim kecil, tanpa persetujuan berlapis):
 *  1. Atasan langsung (kepegawaian — BUKAN PIC proyek) berwenang atas bawahan langsungnya.
 *  2. Pengganti yang ditunjuk untuk atasan itu (rentang tanggal) juga berwenang.
 *  3. Bila atasan tidak ada hari ini (nonaktif atau cuti/izin/sakit sehari penuh yang disetujui) DAN tidak punya pengganti,
 *     wewenang naik ke atasannya (eskalasi), dan seterusnya sampai paling banyak MAX_ESCALATION_LEVELS tingkat.
 *  4. Tidak seorang pun berwenang atas pengajuannya sendiri.
 * HR/Super Admin memantau dan dapat memproses lewat izin peran (`leave:review` / `overtime:review`) — di luar fungsi ini.
 */
export type SupervisorCapacity = "SUPERVISOR" | "DELEGATE" | "ESCALATION";

export interface OrgNode { id: string; supervisorId: string | null; active: boolean }

export interface OrgGraph {
  nodes: ReadonlyMap<string, OrgNode>;
  /** Karyawan yang tidak masuk kerja sehari penuh hari ini (izin/sakit/cuti disetujui). */
  away: ReadonlySet<string>;
  /** Penunjukan pengganti yang berlaku hari ini: id atasan → id para pengganti. */
  delegates: ReadonlyMap<string, ReadonlySet<string>>;
}

export const MAX_ESCALATION_LEVELS = 3;

/** Rantai atasan seorang karyawan: [atasan langsung, atasannya, …]. Berhenti pada siklus atau setelah MAX_ESCALATION_LEVELS tingkat. */
export function supervisorChain(g: OrgGraph, employeeId: string): OrgNode[] {
  const out: OrgNode[] = [];
  const seen = new Set<string>([employeeId]);
  let cur = g.nodes.get(employeeId)?.supervisorId ?? null;
  while (cur && !seen.has(cur) && out.length < MAX_ESCALATION_LEVELS) {
    const node = g.nodes.get(cur);
    if (!node) break;
    out.push(node);
    seen.add(cur);
    cur = node.supervisorId;
  }
  return out;
}

/** "Tercakup" = ada yang bisa memutuskan atas nama tingkat ini: orangnya sendiri hadir dan aktif, atau punya pengganti yang berlaku. */
function covered(g: OrgGraph, s: OrgNode): boolean {
  return (s.active && !g.away.has(s.id)) || (g.delegates.get(s.id)?.size ?? 0) > 0;
}

export interface Reviewer { employeeId: string; capacity: SupervisorCapacity }

/** Semua karyawan yang berwenang meninjau pengajuan `targetId` hari ini (tanpa HR/Super Admin). Kosong = belum ada atasan / tak ada yang terjangkau. */
export function reviewersOf(g: OrgGraph, targetId: string): Reviewer[] {
  const chain = supervisorChain(g, targetId);
  const out = new Map<string, SupervisorCapacity>();
  const add = (id: string, capacity: SupervisorCapacity) => { if (id !== targetId && g.nodes.get(id)?.active && !out.has(id)) out.set(id, capacity); };
  if (chain.length === 0) return [];
  // Tingkat 1: atasan langsung selalu berwenang; penggantinya juga.
  add(chain[0]!.id, "SUPERVISOR");
  for (const d of g.delegates.get(chain[0]!.id) ?? []) add(d, "DELEGATE");
  // Eskalasi: hanya selama tingkat di bawahnya tidak tercakup.
  for (let i = 1; i < chain.length && !covered(g, chain[i - 1]!); i++) {
    add(chain[i]!.id, "ESCALATION");
    for (const d of g.delegates.get(chain[i]!.id) ?? []) add(d, "DELEGATE");
  }
  return [...out].map(([employeeId, capacity]) => ({ employeeId, capacity }));
}

/** Kapasitas `actorId` untuk meninjau pengajuan `targetId`; null = tidak berwenang (termasuk bila actor = target). */
export function reviewCapacity(g: OrgGraph, actorId: string, targetId: string): SupervisorCapacity | null {
  if (actorId === targetId) return null;
  return reviewersOf(g, targetId).find((r) => r.employeeId === actorId)?.capacity ?? null;
}

/** Id karyawan yang pengajuannya boleh ditinjau `actorId` saat ini, beserta kapasitasnya. */
export function reviewableTargets(g: OrgGraph, actorId: string): Map<string, SupervisorCapacity> {
  const out = new Map<string, SupervisorCapacity>();
  for (const [id, node] of g.nodes) {
    if (!node.active || id === actorId) continue;
    const c = reviewCapacity(g, actorId, id);
    if (c) out.set(id, c);
  }
  return out;
}

/** Apakah `candidateId` berada di atas `employeeId` pada rantai atasan (dipakai mencegah rantai melingkar sebelum menyimpan). */
export function wouldCreateCycle(g: OrgGraph, employeeId: string, newSupervisorId: string): boolean {
  if (employeeId === newSupervisorId) return true;
  const seen = new Set<string>();
  let cur: string | null = newSupervisorId;
  while (cur && !seen.has(cur)) {
    if (cur === employeeId) return true;
    seen.add(cur);
    cur = g.nodes.get(cur)?.supervisorId ?? null;
  }
  return false;
}
