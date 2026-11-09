/**
 * Seed DEMONSTRASI modul Training & Operations (`npm run db:seed:training-demo`): data FIKTIF berlabel "[DEMO]".
 * Dijalankan SESUDAH `npm run db:seed:dev` (butuh akun demo). MENOLAK berjalan bila:
 *  - NODE_ENV=production, atau database bukan lokal (sama dengan seed-dev);
 *  - TRAINING_MODULE_ENABLED bukan "true" (modul harus sengaja dinyalakan);
 *  - sudah ada proyek pelatihan (tidak menimpa data).
 * Seluruh data dibuat lewat SERVICE yang sama dengan aplikasi, sehingga aturan validasi, audit, dan akses ikut berlaku.
 * Pemetaan akses demo: ayu = Koordinator Program, budi = Admin Program, citra = anggota proyek biasa, hr = TANPA akses
 * (mendemonstrasikan bahwa "admin HRIS" bukan "Admin Program"). Tidak ada seed otomatis di production.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import type { Actor } from "../src/server/actor";
import { createProject, addMember, changeProjectStatus, createProgram } from "../src/server/services/training/projects";
import { addChecklistItem, createTask, ensureDefaultTemplate, applyChecklistTemplate, changeTaskStatus, updateChecklistItem, listChecklist } from "../src/server/services/training/work";
import { addParticipant, assignInstructor, createInstructor, createSchedule } from "../src/server/services/training/operations";
import { completeMilestone, listMilestones } from "../src/server/services/training/indicator-data";
import { saveIndicatorConfig } from "../src/server/services/training/indicator-config";
import { defaultIndicatorConfig } from "../src/lib/training/indicators/config";
import { addDays, todayIso } from "../src/lib/time";

const prisma = new PrismaClient();

async function actorOf(email: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { employee: { select: { id: true } } } });
  return { userId: u.id, email: u.email, name: u.name, role: u.role, employeeId: u.employee?.id ?? null, ip: null, userAgent: "seed-training-demo" };
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed demo DITOLAK: NODE_ENV=production.");
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(host)) throw new Error(`Seed demo DITOLAK: database "${host || "?"}" bukan database lokal.`);
  if (process.env.TRAINING_MODULE_ENABLED !== "true") throw new Error('Seed demo DITOLAK: set TRAINING_MODULE_ENABLED="true" dulu (modul sengaja dinyalakan).');
  if ((await prisma.trainingProject.count()) > 0) throw new Error("Seed demo DITOLAK: sudah ada proyek pelatihan.");
  if ((await prisma.user.count({ where: { email: { endsWith: "@demo.hris.test" } } })) === 0) throw new Error("Jalankan `npm run db:seed:dev` lebih dulu (butuh akun demo).");

  const boss = await actorOf("pimpinan@demo.hris.test");
  const ayu = await actorOf("ayu@demo.hris.test");
  const budi = await actorOf("budi@demo.hris.test");
  const citra = await actorOf("citra@demo.hris.test");
  await prisma.trainingAccess.createMany({ data: [
    { userId: ayu.userId, level: "COORDINATOR", grantedById: boss.userId, note: "DEMO: Koordinator Program" },
    { userId: budi.userId, level: "ADMIN_PROGRAM", grantedById: boss.userId, note: "DEMO: Admin Program" },
  ] });

  // Konfigurasi indikator DEMO: nilai bawaan dokumen + pemegang jabatan akun demo (agar milestone punya PIC & jam kerja terbentuk).
  const cfg = defaultIndicatorConfig();
  cfg.roleHolders = {
    SPV_CURRICULUM: ayu.employeeId, MANAGER_OPS: ayu.employeeId, MANAGER_MARKETING: budi.employeeId, STAFF_CURRICULUM: budi.employeeId,
    STAFF_ADMISI_1: budi.employeeId, FACILITATOR: budi.employeeId, STAFF_GENERAL: citra.employeeId,
  };
  cfg.facilitators = [budi.employeeId!, citra.employeeId!];
  await saveIndicatorConfig(boss, { config: cfg, note: "[DEMO] Pemegang jabatan akun demo" });

  const today = todayIso("Asia/Jakarta");
  const d = (n: number) => addDays(today, n);
  const tpl = await ensureDefaultTemplate(ayu);

  const prog = await createProgram(ayu, { name: "Sertifikasi BNSP Food Production [DEMO]", kind: "CERTIFICATION", description: "Data demo — program contoh." });
  await createProgram(ayu, { name: "Pelatihan Digital Marketing [DEMO]", kind: "REGULAR", description: "Data demo." });
  await createProgram(ayu, { name: "Pelatihan HACCP [DEMO]", kind: "REGULAR", description: "Data demo." });

  // 1) Proyek berjalan dengan PIC = ayu, tim lengkap, tugas (satu terlambat), checklist sebagian
  const a = await createProject(ayu, { name: "Sertifikasi Food Production — Batch Yogyakarta [DEMO]", programId: prog.id, kind: "CERTIFICATION", clientName: "Mitra Demo A", deliveryMode: "ONSITE", location: "Yogyakarta (data demo)", startDate: d(-1), endDate: d(3), checklistTemplateId: tpl.id, picEmployeeId: ayu.employeeId, track: "REGULAR", bnsp: true, participantsMin: 12 });
  await addMember(ayu, a.id, { employeeId: budi.employeeId!, role: "ADMIN_PROGRAM" });
  await addMember(ayu, a.id, { employeeId: citra.employeeId!, role: "PARTICIPANT_OWNER" });
  await changeProjectStatus(ayu, a.id, { to: "PREPARATION" });
  await changeProjectStatus(ayu, a.id, { to: "RUNNING" });
  const t1 = await createTask(ayu, a.id, { title: "Konfirmasi asesor BNSP", assigneeId: budi.employeeId!, dueDate: d(-2), priority: "HIGH" });
  await createTask(ayu, a.id, { title: "Cetak daftar hadir & sertifikat", assigneeId: citra.employeeId!, dueDate: d(1), priority: "NORMAL" });
  const t3 = await createTask(ayu, a.id, { title: "Susun laporan kegiatan", assigneeId: budi.employeeId!, dueDate: d(4), requiresReview: true });
  await changeTaskStatus(budi, t1.id, { status: "IN_PROGRESS", note: "Menunggu balasan LSP" });
  await changeTaskStatus(budi, t3.id, { status: "IN_PROGRESS" });
  const cl = await listChecklist(ayu, a.id);
  for (const it of cl.items.filter((i) => i.phase === "PREPARATION").slice(0, 5)) await updateChecklistItem(ayu, it.id, { isDone: true });
  const ins = await createInstructor(ayu, { name: "Chef Contoh (DEMO)", kind: "ASSESSOR", organization: "LSP Demo", expertise: "Food Production" });
  const asg = await assignInstructor(ayu, a.id, { instructorId: ins.id, kind: "ASSESSOR", confirmation: "CONFIRMED" });
  await createSchedule(ayu, a.id, { title: "Uji kompetensi — hari 1", date: d(1), startTime: "08:30", endTime: "16:00", room: "Dapur Praktik 1", projectInstructorId: asg.id, inchargeId: budi.employeeId!, status: "CONFIRMED" });
  await createSchedule(ayu, a.id, { title: "Uji kompetensi — hari 2", date: d(2), startTime: "08:30", endTime: "16:00", room: "Dapur Praktik 1", projectInstructorId: asg.id });
  for (const [n, o, s, c] of [["Peserta Demo 1", "PT Contoh", "READY", true], ["Peserta Demo 2", "CV Fiktif", "INCOMPLETE_DOCS", true], ["Peserta Demo 3", "Mandiri", "REGISTERED", false]] as const) await addParticipant(citra, a.id, { fullName: n, organization: o, status: s, confirmed: c, phone: "0812-0000-0000", email: "peserta@demo.invalid" });
  // Beberapa milestone awal sudah selesai (dengan bukti fiktif) agar indikator menampilkan campuran Hijau/Kuning/Merah.
  for (const m of (await listMilestones(ayu, a.id)).filter((x) => ["R01", "R02", "R03", "R07"].includes(x.code))) await completeMilestone(ayu, m.id, { evidence: "[DEMO] Bukti contoh — bukan dokumen asli" });

  // 2) Proyek persiapan oleh admin program (tanpa PIC → tampil "perlu perhatian" setelah dipromosikan manajer)
  const b = await createProject(budi, { name: "Pelatihan Digital Marketing — In-house [DEMO]", kind: "IN_HOUSE", clientName: "PT Klien Demo", deliveryMode: "ONLINE", location: "Platform daring (demo)", startDate: d(30), endDate: d(31), track: "PARTNER", requestDate: d(-3), participantsMin: 20 });
  await addChecklistItem(budi, b.id, { phase: "PREPARATION", title: "Kirim proposal ke klien", isRequired: true });

  // 3) Proyek draf
  await createProject(ayu, { name: "Pelatihan HACCP — Batch Medan [DEMO]", kind: "REGULAR", deliveryMode: "HYBRID", startDate: d(30), endDate: d(31), picEmployeeId: ayu.employeeId, track: "REGULAR", participantsMin: 15 });
  await applyChecklistTemplate(ayu, (await prisma.trainingProject.findFirstOrThrow({ where: { name: { contains: "HACCP" } } })).id, { templateId: tpl.id });

  console.log("\n✔ Data demo Training & Operations dibuat (3 program, 3 proyek, tugas, checklist, jadwal, peserta, instruktur, konfigurasi indikator & milestone).");
  console.log("  Akses demo: ayu = Koordinator Program · budi = Admin Program · citra = PJ Peserta (anggota) · pimpinan = Super Admin (lihat) · hr = tanpa akses.");
}

main().catch((e) => { console.error(`Gagal: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
