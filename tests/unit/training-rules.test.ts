import { describe, expect, it } from "vitest";
import { PROJECT_FORWARD, PROJECT_TRANSITIONS, allowedTaskTransitions, canProjectTransition, checkReadyForPreparation } from "@/lib/training/status";
import { ATTENTION_WINDOW_DAYS, attentionReasons, checklistProgress, closureReadiness, isTaskDueSoon, isTaskDueToday, isTaskOverdue, requiredOutstanding } from "@/lib/training/indicators";
import { DEFAULT_TEMPLATE_ITEMS, formatProjectCode, intervalsOverlap, normalizeRoom } from "@/lib/training/misc";
import { PROJECT_STATUSES, TASK_STATUSES, isActiveProject, isFinalProject, isOpenTask, type ProjectStatus, type TaskStatus } from "@/lib/training/types";
import { addDays } from "@/lib/time";
import { projectCreateSchema, scheduleSchema, participantSchema, projectCloseSchema, templateSaveSchema } from "@/lib/validation/training";

describe("alur status proyek", () => {
  it("maju berurutan; selesai/batal punya alur sendiri; Dibatalkan final; hanya Selesai yang dapat dibuka kembali", () => {
    expect(PROJECT_FORWARD).toEqual({ DRAFT: "PREPARATION", PREPARATION: "RUNNING" });
    expect(canProjectTransition("DRAFT", "RUNNING")).toBe(false);
    expect(canProjectTransition("DRAFT", "COMPLETED")).toBe(false);
    expect(canProjectTransition("RUNNING", "COMPLETED")).toBe(true);
    expect(canProjectTransition("COMPLETED", "RUNNING")).toBe(true);
    expect(PROJECT_TRANSITIONS.CANCELLED).toEqual([]);
    for (const from of PROJECT_STATUSES) for (const to of PROJECT_STATUSES) if (from === to) expect(canProjectTransition(from, to)).toBe(false);
  });

  it("syarat Persiapan: tanggal lengkap + PIC, dengan pesan untuk pengguna", () => {
    expect(checkReadyForPreparation({ startDate: "2027-01-01", endDate: "2027-01-02", hasPic: true })).toEqual({ ok: true, problems: [] });
    const r = checkReadyForPreparation({ startDate: null, endDate: "2027-01-02", hasPic: false });
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(2);
  });

  it("proyek aktif = Persiapan/Berjalan; final = Selesai/Dibatalkan", () => {
    const active = PROJECT_STATUSES.filter(isActiveProject);
    expect(active).toEqual(["PREPARATION", "RUNNING"]);
    expect(PROJECT_STATUSES.filter(isFinalProject)).toEqual(["COMPLETED", "CANCELLED"]);
  });
});

describe("alur status tugas (properti)", () => {
  const combos = TASK_STATUSES.flatMap((status) => [true, false].flatMap((requiresReview) => [true, false].flatMap((isAssignee) => [true, false].map((canManage) => ({ status, requiresReview, isAssignee, canManage })))));

  it("tidak pernah menawarkan status saat ini, dan pelaku tanpa peran apa pun tidak mendapat pilihan", () => {
    for (const c of combos) {
      const out = allowedTaskTransitions(c);
      expect(out).not.toContain(c.status);
      if (!c.isAssignee && !c.canManage) expect(out).toEqual([]);
    }
  });

  it("tugas yang perlu diperiksa tidak pernah dapat langsung Selesai dari Belum dikerjakan/Dalam proses — oleh siapa pun", () => {
    for (const c of combos.filter((x) => x.requiresReview && (x.status === "TODO" || x.status === "IN_PROGRESS"))) expect(allowedTaskTransitions(c)).not.toContain("DONE");
  });

  it("pemeriksa ≠ penanggung jawab: penanggung jawab tidak pernah dapat menyelesaikan tugas dari Menunggu pemeriksaan", () => {
    for (const canManage of [true, false]) expect(allowedTaskTransitions({ status: "IN_REVIEW", requiresReview: true, isAssignee: true, canManage })).not.toContain("DONE");
    expect(allowedTaskTransitions({ status: "IN_REVIEW", requiresReview: true, isAssignee: false, canManage: true })).toContain("DONE");
  });

  it("penanggung jawab biasa: tidak dapat membatalkan atau membuka kembali tugas yang selesai/dibatalkan", () => {
    for (const status of ["DONE", "CANCELLED"] as TaskStatus[]) expect(allowedTaskTransitions({ status, requiresReview: false, isAssignee: true, canManage: false })).toEqual([]);
    for (const status of ["TODO", "IN_PROGRESS", "IN_REVIEW"] as TaskStatus[]) expect(allowedTaskTransitions({ status, requiresReview: true, isAssignee: true, canManage: false })).not.toContain("CANCELLED");
  });

  it("tugas tanpa pemeriksaan: penanggung jawab dapat menyelesaikan langsung; pengelola dapat membuka kembali yang selesai", () => {
    expect(allowedTaskTransitions({ status: "TODO", requiresReview: false, isAssignee: true, canManage: false })).toEqual(["IN_PROGRESS", "DONE"]);
    expect(allowedTaskTransitions({ status: "DONE", requiresReview: false, isAssignee: false, canManage: true })).toEqual(["IN_PROGRESS"]);
  });
});

describe("indikator (definisi tertulis)", () => {
  const today = "2026-11-10";
  it("tugas terlambat: terbuka & tenggat < hari ini; hari ini bukan terlambat; selesai/batal tidak pernah", () => {
    expect(isTaskOverdue({ status: "TODO", dueDate: "2026-11-09" }, today)).toBe(true);
    expect(isTaskOverdue({ status: "TODO", dueDate: today }, today)).toBe(false);
    expect(isTaskOverdue({ status: "IN_REVIEW", dueDate: "2020-01-01" }, today)).toBe(true);
    for (const s of ["DONE", "CANCELLED"] as TaskStatus[]) expect(isTaskOverdue({ status: s, dueDate: "2020-01-01" }, today)).toBe(false);
    expect(isTaskOverdue({ status: "TODO", dueDate: null }, today)).toBe(false);
    expect(isTaskDueToday({ status: "TODO", dueDate: today }, today)).toBe(true);
    expect(isTaskDueSoon({ status: "TODO", dueDate: addDays(today, 3) }, today)).toBe(true);
    expect(isTaskDueSoon({ status: "TODO", dueDate: addDays(today, 4) }, today)).toBe(false);
    expect(isTaskDueSoon({ status: "TODO", dueDate: addDays(today, -1) }, today)).toBe(false);
    expect(TASK_STATUSES.filter(isOpenTask)).toEqual(["TODO", "IN_PROGRESS", "IN_REVIEW"]);
  });

  it("progres checklist: tanpa item = null ('Belum tersedia'), bukan 0%; pembulatan wajar", () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, percent: null });
    expect(checklistProgress([{ isDone: false }])).toEqual({ done: 0, total: 1, percent: 0 });
    expect(checklistProgress([{ isDone: true }, { isDone: false }, { isDone: false }]).percent).toBe(33);
    expect(checklistProgress([{ isDone: true }, { isDone: true }, { isDone: false }]).percent).toBe(67);
  });

  it("perlu perhatian: hanya proyek AKTIF; aturan tugas terlambat, checklist wajib mendekati mulai, tanpa PIC, lewat tanggal selesai", () => {
    const base = { startDate: "2026-11-20", endDate: "2026-11-25", hasPic: true, overdueTasks: 0, requiredOutstanding: 0, today };
    expect(attentionReasons({ ...base, status: "RUNNING" })).toEqual([]);
    expect(attentionReasons({ ...base, status: "RUNNING", overdueTasks: 2 })).toEqual(["OVERDUE_TASKS"]);
    expect(attentionReasons({ ...base, status: "PREPARATION", hasPic: false })).toEqual(["NO_PIC"]);
    // checklist wajib: perhatian bila mulai ≤ 7 hari (batas inklusif), tidak bila lebih jauh
    expect(attentionReasons({ ...base, status: "PREPARATION", requiredOutstanding: 1, startDate: addDays(today, ATTENTION_WINDOW_DAYS) })).toEqual(["REQUIRED_CHECKLIST"]);
    expect(attentionReasons({ ...base, status: "PREPARATION", requiredOutstanding: 1, startDate: addDays(today, ATTENTION_WINDOW_DAYS + 1) })).toEqual([]);
    expect(attentionReasons({ ...base, status: "RUNNING", requiredOutstanding: 1, startDate: addDays(today, -3) })).toEqual(["REQUIRED_CHECKLIST"]); // sudah mulai
    expect(attentionReasons({ ...base, status: "RUNNING", endDate: addDays(today, -1) })).toEqual(["PAST_END_NOT_CLOSED"]);
    for (const s of ["DRAFT", "COMPLETED", "CANCELLED"] as ProjectStatus[]) expect(attentionReasons({ ...base, status: s, overdueTasks: 9, hasPic: false, endDate: "2020-01-01" })).toEqual([]);
  });

  it("kesiapan penutupan: hanya checklist WAJIB yang menghalangi; tugas terbuka hanya dihitung", () => {
    const r = closureReadiness([{ isRequired: true, isDone: true }, { isRequired: false, isDone: false }], [{ status: "TODO", dueDate: null }, { status: "DONE", dueDate: null }]);
    expect(r).toEqual({ canCloseClean: true, requiredOutstanding: 0, openTasks: 1 });
    expect(closureReadiness([{ isRequired: true, isDone: false }], []).canCloseClean).toBe(false);
    expect(requiredOutstanding([{ isRequired: true, isDone: false }, { isRequired: true, isDone: true }, { isRequired: false, isDone: false }])).toHaveLength(1);
  });
});

describe("utilitas murni", () => {
  it("kode proyek: TRN-tahun-0001; lebih dari 9999 tetap valid", () => {
    expect(formatProjectCode(2026, 1)).toBe("TRN-2026-0001");
    expect(formatProjectCode(2026, 42)).toBe("TRN-2026-0042");
    expect(formatProjectCode(2026, 12345)).toBe("TRN-2026-12345");
    expect(formatProjectCode(2026, 12345)).toMatch(/^TRN-[0-9]{4}-[0-9]{4,}$/); // sama dengan CHECK database
  });

  it("bentrok waktu: beririsan = bentrok; bersentuhan di batas = bukan; tercakup = bentrok", () => {
    const t = (h: number) => new Date(Date.UTC(2027, 0, 1, h));
    expect(intervalsOverlap(t(9), t(12), t(11), t(13))).toBe(true);
    expect(intervalsOverlap(t(9), t(12), t(12), t(14))).toBe(false);
    expect(intervalsOverlap(t(9), t(12), t(7), t(9))).toBe(false);
    expect(intervalsOverlap(t(9), t(17), t(10), t(11))).toBe(true);
    expect(intervalsOverlap(t(10), t(11), t(9), t(17))).toBe(true);
  });

  it("label ruangan dinormalisasi (huruf besar/kecil & spasi ganda); kosong = tanpa ruangan", () => {
    expect(normalizeRoom("  Ruang   UTAMA ")).toBe("ruang utama");
    expect(normalizeRoom("")).toBeNull();
    expect(normalizeRoom(undefined)).toBeNull();
  });

  it("template standar: memuat tiga tahap, memiliki item wajib, dan tidak ada judul ganda", () => {
    const phases = new Set(DEFAULT_TEMPLATE_ITEMS.map((i) => i.phase));
    expect([...phases].sort()).toEqual(["CLOSING", "EXECUTION", "PREPARATION"]);
    expect(DEFAULT_TEMPLATE_ITEMS.filter((i) => i.isRequired).length).toBeGreaterThan(3);
    expect(new Set(DEFAULT_TEMPLATE_ITEMS.map((i) => i.title)).size).toBe(DEFAULT_TEMPLATE_ITEMS.length);
  });
});

describe("validasi input (Zod)", () => {
  it("proyek: nama minimal, tanggal terbalik ditolak, UUID dan default benar", () => {
    expect(projectCreateSchema.safeParse({ name: "ab" }).success).toBe(false);
    const bad = projectCreateSchema.safeParse({ name: "Proyek uji", startDate: "2027-02-10", endDate: "2027-02-01" });
    expect(bad.success).toBe(false);
    const ok = projectCreateSchema.parse({ name: "Proyek uji" });
    expect(ok).toMatchObject({ kind: "REGULAR", deliveryMode: "ONSITE", programId: null, picEmployeeId: null, startDate: null });
    expect(projectCreateSchema.safeParse({ name: "Proyek uji", programId: "bukan-uuid" }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ name: "Proyek uji", startDate: "2027-02-30" }).success).toBe(false); // tanggal fiktif
  });

  it("jadwal: jam selesai harus setelah jam mulai; peserta: telepon & email divalidasi; penutupan: ringkasan wajib", () => {
    const s = (over: object) => scheduleSchema.safeParse({ title: "Sesi", date: "2027-01-01", startTime: "09:00", endTime: "10:00", ...over });
    expect(s({}).success).toBe(true);
    expect(s({ endTime: "09:00" }).success).toBe(false);
    expect(s({ startTime: "25:00" }).success).toBe(false);
    expect(participantSchema.safeParse({ fullName: "Ani", phone: "0812-3456-7890", email: "ani@contoh.test" }).success).toBe(true);
    expect(participantSchema.safeParse({ fullName: "Ani", phone: "abc DEMO" }).success).toBe(false);
    expect(participantSchema.safeParse({ fullName: "Ani", email: "bukan-email" }).success).toBe(false);
    expect(projectCloseSchema.safeParse({ summary: "ok" }).success).toBe(false);
    expect(templateSaveSchema.safeParse({ name: "Template", items: [] }).success).toBe(false);
  });
});
