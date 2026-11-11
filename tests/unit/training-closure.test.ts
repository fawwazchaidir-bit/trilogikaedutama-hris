/**
 * Penutupan proyek — logika murni: keputusan per tugas terbuka (tindak lanjut / batal), pengakuan pelonggaran, definisi tugas "hidup".
 */
import { describe, expect, it } from "vitest";
import { checkClosureTasks, isLiveFollowUp, unacknowledgedRelaxations, type ClosureTaskDecision, type OpenTaskLite } from "@/lib/training/closure";
import { projectCloseSchema, checklistItemDeleteSchema, checklistItemUpdateSchema } from "@/lib/validation/training";

const TODAY = "2027-03-15";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", E2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const task = (id: string, over: Partial<OpenTaskLite> = {}): OpenTaskLite => ({ id, title: `Tugas ${id.slice(0, 2)}`, status: "TODO", assigneeId: E1, dueDate: "2027-03-20", ...over });
const dec = (taskId: string, over: Partial<ClosureTaskDecision> = {}): ClosureTaskDecision => ({ taskId, action: "FOLLOW_UP", ...over });

describe("keputusan tugas terbuka saat menutup proyek", () => {
  it("tanpa tugas terbuka: tanpa keputusan pun sah", () => {
    expect(checkClosureTasks([task(A, { status: "DONE" }), task(B, { status: "CANCELLED" })], [], TODAY).ok).toBe(true);
  });

  it("tugas terbuka tanpa keputusan → tidak sah, daftar yang belum diputuskan dikembalikan", () => {
    const r = checkClosureTasks([task(A), task(B)], [dec(A)], TODAY);
    expect(r.ok).toBe(false);
    expect(r.undecided.map((t) => t.id)).toEqual([B]);
    expect(r.plan.followUp.map((f) => f.taskId)).toEqual([A]);
  });

  it("tindak lanjut memakai penanggung jawab & tenggat tugas bila masih sah; boleh diganti", () => {
    const r = checkClosureTasks([task(A), task(B)], [dec(A), dec(B, { assigneeId: E2, dueDate: "2027-04-01" })], TODAY);
    expect(r.ok).toBe(true);
    expect(r.plan.followUp).toEqual([
      { taskId: A, title: "Tugas 11", assigneeId: E1, dueDate: "2027-03-20", assigneeChanged: false, dueChanged: false, reason: null },
      { taskId: B, title: "Tugas 22", assigneeId: E2, dueDate: "2027-04-01", assigneeChanged: true, dueChanged: true, reason: null },
    ]);
  });

  it("tindak lanjut wajib punya penanggung jawab", () => {
    const r = checkClosureTasks([task(A, { assigneeId: null })], [dec(A)], TODAY);
    expect(r.ok).toBe(false);
    expect(r.invalid[0]!.message).toMatch(/penanggung jawab/i);
    expect(checkClosureTasks([task(A, { assigneeId: null })], [dec(A, { assigneeId: E2 })], TODAY).ok).toBe(true);
  });

  it("tindak lanjut wajib punya tenggat yang BELUM lewat (hari ini boleh); tenggat lama yang sudah lewat harus diganti", () => {
    expect(checkClosureTasks([task(A, { dueDate: null })], [dec(A)], TODAY).invalid[0]!.message).toMatch(/tenggat/i);
    expect(checkClosureTasks([task(A, { dueDate: "2027-03-10" })], [dec(A)], TODAY).invalid[0]!.message).toMatch(/sudah lewat/i);
    expect(checkClosureTasks([task(A, { dueDate: "2027-03-10" })], [dec(A, { dueDate: "2027-03-14" })], TODAY).ok).toBe(false);
    expect(checkClosureTasks([task(A, { dueDate: "2027-03-10" })], [dec(A, { dueDate: TODAY })], TODAY).ok).toBe(true);
  });

  it("mengganti penanggung jawab tugas yang SUDAH DIMULAI wajib beralasan (sama dengan aturan ubah tugas); tugas belum dimulai tidak", () => {
    const started = task(A, { status: "IN_PROGRESS" });
    expect(checkClosureTasks([started], [dec(A, { assigneeId: E2 })], TODAY).invalid[0]!.message).toMatch(/alasan/i);
    expect(checkClosureTasks([started], [dec(A, { assigneeId: E2, reason: "Ayu pindah divisi" })], TODAY).ok).toBe(true);
    expect(checkClosureTasks([started], [dec(A, { assigneeId: E1 })], TODAY).ok).toBe(true);                    // tidak diganti
    expect(checkClosureTasks([task(A)], [dec(A, { assigneeId: E2 })], TODAY).ok).toBe(true);                    // belum dimulai
  });

  it("pembatalan wajib beralasan (≥ 5 karakter)", () => {
    expect(checkClosureTasks([task(A)], [dec(A, { action: "CANCEL" })], TODAY).invalid[0]!.message).toMatch(/alasan/i);
    expect(checkClosureTasks([task(A)], [dec(A, { action: "CANCEL", reason: "abc" })], TODAY).ok).toBe(false);
    const ok = checkClosureTasks([task(A)], [dec(A, { action: "CANCEL", reason: "  Klien membatalkan sesi  " })], TODAY);
    expect(ok.ok).toBe(true);
    expect(ok.plan.cancel).toEqual([{ taskId: A, title: "Tugas 11", reason: "Klien membatalkan sesi" }]);
  });

  it("keputusan ganda dan ID yang bukan tugas terbuka ditolak (daftar berubah → muat ulang)", () => {
    expect(checkClosureTasks([task(A)], [dec(A), dec(A)], TODAY).invalid[0]!.message).toMatch(/ganda/i);
    const r = checkClosureTasks([task(A, { status: "DONE" })], [dec(A)], TODAY);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual([A]);
  });

  it("'Selesai' bukan pilihan saat menutup: skema menolaknya (tugas diselesaikan lewat alurnya, termasuk pemeriksaan)", () => {
    const base = { summary: "Selesai dengan baik", taskDecisions: [{ taskId: A, action: "DONE" }] };
    expect(projectCloseSchema.safeParse(base).success).toBe(false);
    expect(projectCloseSchema.safeParse({ ...base, taskDecisions: [{ taskId: A, action: "FOLLOW_UP" }] }).success).toBe(true);
  });
});

describe("skema penutupan & checklist", () => {
  it("bawaan: tanpa keputusan dan tanpa pengakuan", () => {
    const r = projectCloseSchema.parse({ summary: "Selesai dengan baik" });
    expect(r.taskDecisions).toEqual([]);
    expect(r.acknowledgeRelaxed).toBe(false);
  });
  it("alasan pelonggaran opsional di skema (ditegakkan service sesuai status item/proyek)", () => {
    expect(checklistItemUpdateSchema.parse({ isRequired: false, reason: "Klien tidak meminta" }).reason).toBe("Klien tidak meminta");
    expect(checklistItemUpdateSchema.parse({ isDone: true })).not.toHaveProperty("reason");
    expect(checklistItemDeleteSchema.parse({})).toEqual({});
  });
});

describe("pelonggaran checklist wajib & tugas hidup", () => {
  it("hanya yang BELUM diakui yang menuntut pengakuan", () => {
    const list = [{ id: 1, acknowledgedAt: null }, { id: 2, acknowledgedAt: "2027-03-01T00:00:00.000Z" }];
    expect(unacknowledgedRelaxations(list).map((x) => x.id)).toEqual([1]);
    expect(unacknowledgedRelaxations([])).toEqual([]);
  });
  it("tindak lanjut hanya 'hidup' pada proyek yang Selesai", () => {
    expect(isLiveFollowUp("COMPLETED", true)).toBe(true);
    expect(isLiveFollowUp("COMPLETED", false)).toBe(false);
    expect(isLiveFollowUp("CANCELLED", true)).toBe(false);
    expect(isLiveFollowUp("RUNNING", true)).toBe(false);
  });
});
