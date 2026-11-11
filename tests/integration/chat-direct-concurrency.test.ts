/**
 * Japri & utas penugasan dibuat BERSAMAAN oleh dua pihak: harus selalu menghasilkan satu ruang dan baris anggota yang lengkap — TANPA deadlock Postgres (40P01).
 * Penyebab lama: kedua pemanggil menyisipkan baris anggota (ON CONFLICT DO NOTHING) dalam urutan berlawanan ([pelaku, lawan]) sehingga saling menunggu
 * baris yang belum di-commit. Jendelanya sangat sempit (satu pernyataan INSERT), jadi tes ini MELEBARKANNYA dengan trigger uji yang menunda tiap baris:
 * tanpa perbaikan, deadlock terjadi setiap kali (bukan kebetulan).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/actor";
import { addDays, todayIso } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { createAssignment } from "@/server/services/assignments";
import { getOrCreateDirect, getOrCreateSubjectRoom } from "@/server/services/chat/rooms";

const SLOW_MS = 120;
/** Satu pernyataan per panggilan (Prisma menolak beberapa perintah dalam satu pernyataan siap-pakai). */
const slowRows = async () => {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_slow_chat_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${SLOW_MS / 1000}); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_chat_member ON chat_members`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER test_slow_chat_member BEFORE INSERT ON chat_members FOR EACH ROW EXECUTE FUNCTION test_slow_chat_member()`);
};
const fastRows = async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_chat_member ON chat_members`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_slow_chat_member()`);
};

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
afterEach(async () => { await fastRows(); });

async function users(n: number): Promise<Actor[]> {
  const rows = Array.from({ length: n }, (_, i) => ({ id: randomUUID(), email: `u${i}-${randomUUID().slice(0, 6)}@uji.test`, name: `Pengguna ${i}`, role: "EMPLOYEE" as const, passwordHash: "x" }));
  await prisma.user.createMany({ data: rows });
  return rows.map((r) => ({ userId: r.id, email: r.email, name: r.name, role: "EMPLOYEE", employeeId: null, ip: "127.0.0.1", userAgent: "vitest" }));
}
const messageOf = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message.split("\n").find((l) => /deadlock|40P01/i.test(l)) ?? r.reason.message.slice(0, 160) : String(r.reason));

describe("japri bersamaan", () => {
  it("dua orang saling memulai japri pada saat yang sama (penyisipan anggota dilebarkan): tanpa galat, satu ruang, dua anggota", async () => {
    await slowRows();
    const PAIRS = 6;
    const people = await users(PAIRS * 2);
    const calls: Promise<{ id: string; created: boolean }>[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const a = people[2 * i]!, b = people[2 * i + 1]!;
      calls.push(getOrCreateDirect(a, { userId: b.userId }), getOrCreateDirect(b, { userId: a.userId }));
    }
    const res = await Promise.allSettled(calls);
    expect(res.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(messageOf)).toEqual([]);
    for (let i = 0; i < PAIRS; i++) {
      const [x, y] = [res[2 * i], res[2 * i + 1]] as PromiseFulfilledResult<{ id: string; created: boolean }>[];
      expect(x!.value.id).toBe(y!.value.id);
      expect([x!.value.created, y!.value.created].filter(Boolean)).toHaveLength(1);            // tepat satu yang membuat
      expect(await prisma.chatMember.count({ where: { roomId: x!.value.id } })).toBe(2);
    }
    expect(await prisma.chatRoom.count({ where: { kind: "DIRECT" } })).toBe(PAIRS);
  }, 60_000);

  it("tanpa pelambatan: banyak pasangan × kedua arah tetap satu ruang per pasangan", async () => {
    const PAIRS = 40;
    const people = await users(PAIRS * 2);
    const calls: Promise<{ id: string; created: boolean }>[] = [];
    for (let i = 0; i < PAIRS; i++) {
      const a = people[2 * i]!, b = people[2 * i + 1]!;
      calls.push(getOrCreateDirect(a, { userId: b.userId }), getOrCreateDirect(b, { userId: a.userId }));
    }
    const res = await Promise.allSettled(calls);
    expect(res.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(messageOf)).toEqual([]);
    expect(await prisma.chatRoom.count({ where: { kind: "DIRECT" } })).toBe(PAIRS);
    expect(await prisma.chatMember.count()).toBe(PAIRS * 2);
  }, 60_000);
});

describe("utas penugasan bersamaan", () => {
  it("dua penerima tugas membuka utas Surat Tugas bersamaan (penyisipan anggota dilebarkan): tanpa galat, satu utas, semua penerima anggota", async () => {
    const D = addDays(todayIso("Asia/Jakarta"), 3);
    const letter = await createAssignment(fx.hr, { purpose: "Pendampingan uji", destination: "Surakarta", startDate: D, endDate: D, assignees: [0, 1, 2].map((i) => ({ employeeId: fx.empIds[i]!, dailyRate: 300_000 })) });
    await slowRows();
    const res = await Promise.allSettled([fx.emp1, fx.emp2, fx.emp3].map((a) => getOrCreateSubjectRoom(a, { type: "ASSIGNMENT_LETTER", id: letter.id })));
    expect(res.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(messageOf)).toEqual([]);
    const ok = res as PromiseFulfilledResult<{ id: string; created: boolean }>[];
    expect(new Set(ok.map((r) => r.value.id)).size).toBe(1);
    expect(ok.filter((r) => r.value.created)).toHaveLength(1);
    const members = await prisma.chatMember.findMany({ where: { roomId: ok[0]!.value.id }, select: { userId: true } });
    expect(members.map((m) => m.userId).sort()).toEqual([fx.emp1.userId, fx.emp2.userId, fx.emp3.userId].sort());
  }, 60_000);
});
