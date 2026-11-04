import { describe, expect, it } from "vitest";
import { MON_FRI, type Color, type TriggerCode } from "@/lib/training/indicators/engine";
import { decideProgramEscalations, statusRun, type ProgramState, type SnapshotIn } from "@/lib/training/indicators/escalation";
import { checkIndicatorConfig, defaultEscalation, defaultIndicatorConfig, indicatorConfigSchema } from "@/lib/training/indicators/config";

// Kalender: 2026-11-02 Senin … 2026-11-06 Jumat, 07 Sabtu, 08 Minggu, 09 Senin.
const snap = (date: string, overall: Color): SnapshotIn => ({ date, overall });

describe("statusRun — hari kerja berturut-turut", () => {
  it("menghitung deret yang berakhir hari ini dan mencatat hari awalnya", () => {
    const s = [snap("2026-11-03", "YELLOW"), snap("2026-11-04", "YELLOW"), snap("2026-11-05", "YELLOW")];
    expect(statusRun(s, "2026-11-05", "YELLOW", MON_FRI)).toEqual({ count: 3, startDate: "2026-11-03" });
  });
  it("berhenti pada hari yang statusnya lain atau tidak punya snapshot (tanpa data tidak ada klaim 'berturut-turut')", () => {
    expect(statusRun([snap("2026-11-04", "GREEN"), snap("2026-11-05", "YELLOW")], "2026-11-05", "YELLOW", MON_FRI).count).toBe(1);
    expect(statusRun([snap("2026-11-03", "YELLOW"), snap("2026-11-05", "YELLOW")], "2026-11-05", "YELLOW", MON_FRI).count).toBe(1);
    expect(statusRun([snap("2026-11-05", "RED")], "2026-11-05", "YELLOW", MON_FRI)).toEqual({ count: 0, startDate: null });
  });
  it("akhir pekan dilewati: Jumat Kuning + Senin Kuning = 2 hari berturut-turut; Sabtu/Minggu memakai Jumat sebagai acuan", () => {
    const s = [snap("2026-11-05", "YELLOW"), snap("2026-11-06", "YELLOW"), snap("2026-11-09", "YELLOW")];
    expect(statusRun(s, "2026-11-09", "YELLOW", MON_FRI)).toEqual({ count: 3, startDate: "2026-11-05" });
    expect(statusRun(s.slice(0, 2), "2026-11-07", "YELLOW", MON_FRI)).toEqual({ count: 2, startDate: "2026-11-05" });
    expect(statusRun(s.slice(0, 2), "2026-11-08", "YELLOW", MON_FRI).count).toBe(2);
  });
  it("snapshot akhir pekan tidak dihitung dan tidak memutus", () => {
    const s = [snap("2026-11-06", "YELLOW"), snap("2026-11-07", "GREEN"), snap("2026-11-09", "YELLOW")];
    expect(statusRun(s, "2026-11-09", "YELLOW", MON_FRI).count).toBe(2);
  });
});

const base = (over: Partial<ProgramState> = {}): ProgramState => ({
  projectId: "p1", code: "TRN-2026-0001", name: "Pelatihan HACCP", track: "REGULAR", startDate: "2026-11-20", today: "2026-11-10",
  overall: "GREEN", triggers: [], yellow: { count: 0, startDate: null }, red: { count: 0, startDate: null }, overdue: [], marketingCause: false, ...over,
});
const kinds = (p: ProgramState, cfg = defaultEscalation()) => decideProgramEscalations(p, cfg).map((e) => e.kind);

describe("decideProgramEscalations — dokumen §5.2", () => {
  it("Hijau tidak memicu apa pun; tanpa penilaian (template belum diterapkan) juga tidak", () => {
    expect(kinds(base())).toEqual([]);
    expect(kinds(base({ overall: null }))).toEqual([]);
  });
  it("Kuning hari pertama → hanya PIC; Kuning hari kedua berturut-turut → atasan PIC + PIC, wajib rencana pemulihan", () => {
    const one = decideProgramEscalations(base({ overall: "YELLOW", yellow: { count: 1, startDate: "2026-11-10" } }), defaultEscalation());
    expect(one.map((e) => e.kind)).toEqual(["YELLOW"]);
    expect(one[0]!.recipients).toEqual([{ type: "PIC" }]);
    expect(one[0]!.recovery).toBe(false);
    const two = decideProgramEscalations(base({ overall: "YELLOW", yellow: { count: 2, startDate: "2026-11-09" } }), defaultEscalation());
    expect(two.map((e) => e.kind)).toEqual(["YELLOW", "YELLOW_STREAK"]);
    expect(two[1]!.recipients).toEqual([{ type: "SUPERVISOR_OF_PIC" }, { type: "PIC" }]);
    expect(two[1]!.recovery).toBe(true);
    expect(two[1]!.title).toContain("2 hari kerja berturut-turut");
  });
  it("ambang deret dapat diubah di konfigurasi (3 hari)", () => {
    const cfg = { ...defaultEscalation(), yellowStreakDays: 3 };
    expect(kinds(base({ overall: "YELLOW", yellow: { count: 2, startDate: "2026-11-09" } }), cfg)).toEqual(["YELLOW"]);
    expect(kinds(base({ overall: "YELLOW", yellow: { count: 3, startDate: "2026-11-06" } }), cfg)).toEqual(["YELLOW", "YELLOW_STREAK"]);
  });
  it("kunci dedupe stabil sepanjang satu episode (hari awal deret), berbeda untuk episode baru", () => {
    const a = decideProgramEscalations(base({ overall: "YELLOW", yellow: { count: 2, startDate: "2026-11-09" } }), defaultEscalation());
    const b = decideProgramEscalations(base({ overall: "YELLOW", today: "2026-11-11", yellow: { count: 3, startDate: "2026-11-09" } }), defaultEscalation());
    expect(a.map((e) => e.key)).toEqual(b.map((e) => e.key));
    const c = decideProgramEscalations(base({ overall: "YELLOW", yellow: { count: 1, startDate: "2026-11-16" } }), defaultEscalation());
    expect(c[0]!.key).not.toBe(a[0]!.key);
  });
  it("Merah → pelaksana (atau pemasaran bila penyebabnya klien/pemasaran) + Manajer Operasional + PIC, hari yang sama", () => {
    const exec = decideProgramEscalations(base({ overall: "RED", red: { count: 1, startDate: "2026-11-10" }, triggers: ["CRITICAL_MILESTONE"] }), defaultEscalation())[0]!;
    expect(exec.kind).toBe("RED");
    expect(exec.recipients).toEqual([{ type: "ROLE", roleKey: "SPV_CURRICULUM" }, { type: "ROLE", roleKey: "MANAGER_OPS" }, { type: "PIC" }]);
    expect(exec.body).toContain("Milestone kritikal lewat tenggat");
    const mkt = decideProgramEscalations(base({ overall: "RED", red: { count: 1, startDate: "2026-11-10" }, triggers: ["PROJECTION_LOW"], marketingCause: true }), defaultEscalation())[0]!;
    expect(mkt.recipients[0]).toEqual({ type: "ROLE", roleKey: "MANAGER_MARKETING" });
  });
  it("Merah pada H-7 s.d. H-1 → keputusan Go/No-Go; kerjasama juga memberi tahu Manajer Pemasaran (klien diberi tahu tertulis)", () => {
    const reg = decideProgramEscalations(base({ overall: "RED", red: { count: 1, startDate: "2026-11-10" }, startDate: "2026-11-15" }), defaultEscalation());
    expect(reg.map((e) => e.kind)).toEqual(["RED", "RED_LATE"]);
    expect(reg[1]!.title).toBe("Merah pada H-5: TRN-2026-0001");
    expect(reg[1]!.recipients).toEqual([{ type: "ROLE", roleKey: "MANAGER_OPS" }, { type: "ROLE", roleKey: "SPV_CURRICULUM" }]);
    const partner = decideProgramEscalations(base({ overall: "RED", track: "PARTNER", red: { count: 1, startDate: "2026-11-10" }, startDate: "2026-11-15" }), defaultEscalation());
    expect(partner[1]!.recipients).toContainEqual({ type: "ROLE", roleKey: "MANAGER_MARKETING" });
    expect(partner[1]!.body).toContain("klien diberi tahu tertulis");
  });
  it("Merah di luar jendela H-7…H-1 (terlalu jauh, hari-H, atau sudah lewat) tidak memicu keputusan Go/No-Go", () => {
    for (const startDate of ["2026-11-30", "2026-11-10", "2026-11-01", null]) {
      expect(kinds(base({ overall: "RED", red: { count: 1, startDate: "2026-11-10" }, startDate }))).toEqual(["RED"]);
    }
  });
  it("milestone terlambat melewati ambang → atasan pemegangnya (naik satu tingkat), satu pesan per milestone", () => {
    const ev = decideProgramEscalations(base({ overdue: [{ id: "m1", code: "R04", name: "Instruktur terkonfirmasi", daysOverdue: 4, assigneeId: "e1" }, { id: "m2", code: "R05", name: "Cek", daysOverdue: 5, assigneeId: null }] }), defaultEscalation());
    expect(ev.map((e) => e.key)).toEqual(["overdue:m1", "overdue:m2"]);
    expect(ev[0]!.recipients).toEqual([{ type: "SUPERVISOR_OF_EMPLOYEE", employeeId: "e1", roleKey: null }]);
    expect(ev[1]!.recipients).toEqual([{ type: "SUPERVISOR_OF_PIC" }]); // tanpa PIC milestone → atasan PIC program
    expect(ev[0]!.title).toBe("Milestone R04 terlambat 4 hari");
  });
  it("eskalasi milestone memakai JABATAN milestone itu, bukan semua jabatan yang dirangkap pemegangnya", () => {
    const ev = decideProgramEscalations(base({ overdue: [{ id: "m1", code: "R02", name: "Rencana Kampanye", daysOverdue: 5, assigneeId: "e1", roleKey: "MANAGER_MARKETING" }] }), defaultEscalation());
    expect(ev[0]!.recipients).toEqual([{ type: "SUPERVISOR_OF_EMPLOYEE", employeeId: "e1", roleKey: "MANAGER_MARKETING" }]);
  });
  it("eskalasi dimatikan di konfigurasi → tidak ada pesan", () => {
    expect(kinds(base({ overall: "RED", red: { count: 1, startDate: "2026-11-10" }, triggers: ["CRITICAL_ITEM" as TriggerCode] }), { ...defaultEscalation(), enabled: false })).toEqual([]);
  });
});

describe("konfigurasi eskalasi", () => {
  it("konfigurasi tersimpan SEBELUM fitur ini (tanpa bagian escalation) tetap sah dan memakai nilai bawaan", () => {
    const old: Record<string, unknown> = { ...defaultIndicatorConfig() };
    delete old.escalation;
    const parsed = indicatorConfigSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.escalation).toEqual(defaultEscalation());
  });
  it("bawaan sah; rantai atasan melingkar, jabatan tak dikenal, dan atasan diri sendiri ditolak", () => {
    expect(checkIndicatorConfig(defaultIndicatorConfig()).errors).toEqual([]);
    const c = defaultIndicatorConfig();
    c.escalation.reportsTo = { SPV_CURRICULUM: "MANAGER_OPS", MANAGER_OPS: "SPV_CURRICULUM" };
    expect(checkIndicatorConfig(c).errors.join(" ")).toContain("melingkar");
    const d = defaultIndicatorConfig();
    d.escalation.reportsTo = { SPV_CURRICULUM: "SPV_CURRICULUM" };
    expect(checkIndicatorConfig(d).errors.join(" ")).toContain("atasannya sendiri");
    const e = defaultIndicatorConfig();
    e.escalation.redAlwaysRole = "TIDAK_ADA";
    e.escalation.reportsTo = { HANTU: "MANAGER_OPS" };
    expect(checkIndicatorConfig(e).errors.length).toBeGreaterThanOrEqual(2);
  });
});
