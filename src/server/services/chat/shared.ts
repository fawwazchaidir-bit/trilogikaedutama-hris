import "server-only";
import type { ChatRoom } from "@prisma/client";
import { prisma, type Tx } from "../../db";
import { Errors } from "../../errors";
import { chatEnabled, trainingEnabled } from "../../env";
import type { Actor } from "../../actor";
import { can, type Role } from "@/lib/permissions";
import { isUuid, defaultNotifyMode } from "@/lib/chat/logic";
import type { ChatSubjectTypeValue } from "@/lib/chat/types";
import { isFinalProject } from "@/lib/training/types";
import { loadProjectAccess } from "../training/access";

/**
 * OTORISASI OBROLAN — satu-satunya pintu. Prinsip: izin DIHITUNG, tidak pernah bersandar pada tabel anggota.
 *   Japri   = tepat dua anggota (+ Direktur sebagai pembaca-audit, baca-saja, tercatat).
 *   Kanal   = semua akun aktif.
 *   Utas    = gerbang modul asal (Surat Tugas / proyek Training) pada saat diminta.
 * Tanpa hak baca → 404 (keberadaan ruang tidak bocor); hak baca tanpa hak tulis → 403.
 */
export type Db = Tx | typeof prisma;

/** Subjek akses: cukup tiga hal ini (Actor memenuhinya). */
export interface Who { userId: string; role: Role; employeeId: string | null }
export interface RoomAccess { canRead: boolean; canPost: boolean; auditView: boolean }
export const NO_ACCESS: RoomAccess = { canRead: false, canPost: false, auditView: false };

export function assertChatEnabled(): void {
  if (!chatEnabled()) throw Errors.notFound("Obrolan");
}
export function assertUuidOr404(id: string, what: string): void {
  if (!isUuid(id)) throw Errors.notFound(what);
}

export interface SubjectAccess { canView: boolean; canParticipate: boolean }
const NONE_SUBJECT: SubjectAccess = { canView: false, canParticipate: false };

/** Gerbang subjek penugasan — meminjam aturan modul asal; tidak ada aturan akses kedua. */
export async function subjectAccess(db: Db, who: Who, type: ChatSubjectTypeValue, id: string): Promise<SubjectAccess> {
  if (!isUuid(id)) return NONE_SUBJECT;
  if (type === "ASSIGNMENT_LETTER") {
    const letter = await db.assignmentLetter.findUnique({ where: { id }, select: { status: true, assignees: { select: { employeeId: true } } } });
    if (!letter) return NONE_SUBJECT;
    const isAssignee = !!who.employeeId && letter.assignees.some((a) => a.employeeId === who.employeeId);
    const canView = isAssignee || can(who.role, "assignment:view_all");
    return { canView, canParticipate: canView && letter.status === "ISSUED" };
  }
  // Training: modul harus menyala; akses = hak lihat proyek (sudah memangkas Magang / Pemantau).
  if (!trainingEnabled()) return NONE_SUBJECT;
  let projectId = id;
  if (type === "TRAINING_TASK") {
    const t = await db.trainingTask.findUnique({ where: { id }, select: { projectId: true } });
    if (!t) return NONE_SUBJECT;
    projectId = t.projectId;
  }
  try {
    const a = await loadProjectAccess({ ...who, email: "", name: "" } as Actor, projectId, db);
    const member = a.memberRole !== null || a.module.caps.fullAccess;
    return { canView: true, canParticipate: member && !isFinalProject(a.project.status) };
  } catch {
    return NONE_SUBJECT;
  }
}

/** Hak `who` pada `room`. Pemanggil: tanpa canRead → 404; canRead tanpa canPost → 403. */
export async function resolveAccess(db: Db, who: Who, room: ChatRoom): Promise<RoomAccess> {
  switch (room.kind) {
    case "DIRECT": {
      const members = await db.chatMember.findMany({ where: { roomId: room.id }, select: { userId: true } });
      if (!members.some((m) => m.userId === who.userId)) {
        // Bukan pesertanya: hanya Direktur (chat:audit_access) yang boleh membaca — baca-saja, dan pemanggil wajib mencatatnya.
        return can(who.role, "chat:audit_access") ? { canRead: true, canPost: false, auditView: true } : NO_ACCESS;
      }
      const other = members.find((m) => m.userId !== who.userId);
      const otherActive = other ? !!(await db.user.findFirst({ where: { id: other.userId, isActive: true }, select: { id: true } })) : false;
      return { canRead: true, canPost: otherActive && !room.archivedAt, auditView: false };
    }
    case "CHANNEL":
      return { canRead: true, canPost: !room.archivedAt, auditView: false };
    case "SUBJECT": {
      if (!room.subjectType || !room.subjectId) return NO_ACCESS;
      const a = await subjectAccess(db, who, room.subjectType, room.subjectId);
      return a.canView ? { canRead: true, canPost: a.canParticipate && !room.archivedAt, auditView: false } : NO_ACCESS;
    }
  }
}

/** Muat ruang + hak pelaku. 404 bila tak berhak baca; 403 bila `need = "post"` tanpa hak tulis. */
export async function loadRoom(db: Db, actor: Actor, roomId: string, need: "read" | "post" = "read"): Promise<{ room: ChatRoom; access: RoomAccess }> {
  assertChatEnabled();
  assertUuidOr404(roomId, "Ruang obrolan");
  const room = await db.chatRoom.findUnique({ where: { id: roomId } });
  if (!room) throw Errors.notFound("Ruang obrolan");
  const access = await resolveAccess(db, actor, room);
  if (!access.canRead) throw Errors.notFound("Ruang obrolan");
  if (need === "post" && !access.canPost) throw Errors.forbidden("Anda tidak dapat menulis di ruang ini.");
  return { room, access };
}

/** Pastikan ada baris anggota untuk pembaca yang berhak (belum-dibaca & preferensi). Tidak memberi izin. Mulai dari nomor urut terakhir (tanpa tumpukan lencana lama). */
export async function ensureMember(db: Db, room: Pick<ChatRoom, "id" | "kind" | "lastSeq">, userId: string): Promise<void> {
  await db.chatMember.createMany({ data: [{ roomId: room.id, userId, lastReadSeq: room.lastSeq, notifyMode: defaultNotifyMode(room.kind) }], skipDuplicates: true });
}

export interface PersonRef { userId: string; name: string; role: Role; employeeId: string | null; isActive: boolean }
export async function loadPeople(db: Db, ids: string[]): Promise<Map<string, PersonRef>> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, role: true, isActive: true, employee: { select: { id: true } } } });
  return new Map(rows.map((u) => [u.id, { userId: u.id, name: u.name, role: u.role, employeeId: u.employee?.id ?? null, isActive: u.isActive }]));
}

/** Nama ruang untuk utas penugasan (judul + tautan), dikelompokkan per jenis agar hemat kueri. */
export async function subjectTitles(db: Db, rooms: Pick<ChatRoom, "id" | "subjectType" | "subjectId">[]): Promise<Map<string, { title: string; subtitle: string | null; href: string | null }>> {
  const out = new Map<string, { title: string; subtitle: string | null; href: string | null }>();
  const ids = (t: ChatSubjectTypeValue) => rooms.filter((r) => r.subjectType === t && r.subjectId).map((r) => r.subjectId!);
  const [letters, projects, tasks] = await Promise.all([
    ids("ASSIGNMENT_LETTER").length ? db.assignmentLetter.findMany({ where: { id: { in: ids("ASSIGNMENT_LETTER") } }, select: { id: true, number: true, destination: true } }) : [],
    ids("TRAINING_PROJECT").length ? db.trainingProject.findMany({ where: { id: { in: ids("TRAINING_PROJECT") } }, select: { id: true, code: true, name: true } }) : [],
    ids("TRAINING_TASK").length ? db.trainingTask.findMany({ where: { id: { in: ids("TRAINING_TASK") } }, select: { id: true, title: true, project: { select: { id: true, code: true } } } }) : [],
  ]);
  const byKey = new Map<string, { title: string; subtitle: string | null; href: string | null }>();
  for (const l of letters) byKey.set(`ASSIGNMENT_LETTER:${l.id}`, { title: `Surat Tugas ${l.number}`, subtitle: l.destination, href: "/persuratan/surat-tugas" });
  for (const p of projects) byKey.set(`TRAINING_PROJECT:${p.id}`, { title: `${p.code} · ${p.name}`, subtitle: "Proyek Training", href: `/training/proyek/${p.id}` });
  for (const t of tasks) byKey.set(`TRAINING_TASK:${t.id}`, { title: t.title, subtitle: `Tugas · ${t.project.code}`, href: `/training/proyek/${t.project.id}?tab=tugas` });
  for (const r of rooms) {
    const v = r.subjectType && r.subjectId ? byKey.get(`${r.subjectType}:${r.subjectId}`) : undefined;
    out.set(r.id, v ?? { title: "Utas penugasan", subtitle: null, href: null });
  }
  return out;
}
