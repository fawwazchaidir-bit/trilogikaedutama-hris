/**
 * Indikator pemantauan — diuji terhadap dokumen "Indikator Pemantauan Program Pelatihan" v1.0, termasuk CONTOH PERHITUNGAN Bagian 7
 * (Pelatihan & Sertifikasi HACCP, reguler, skema BNSP, hari ini H-4) sebagai vektor uji.
 */
import { describe, expect, it } from "vitest";
import { addDays, diffDays } from "@/lib/time";
import { checkIndicatorConfig, defaultIndicatorConfig, indicatorConfigSchema, TRACKS } from "@/lib/training/indicators/config";
import {
  addWorkdays, combineStatus, computeProjection, computeReadiness, computeTimeliness, countWorkdays, imbalanceIndex, loadBand, loadColor, loadPct,
  MON_FRI, parallelDensity, participantRamp, programLoad, resolveDueMap, resolveOffset, standardHours, taskHoursInWeek, weekCapacity, worst,
  type ItemIn, type MilestoneIn,
} from "@/lib/training/indicators/engine";

const cfg = defaultIndicatorConfig();
const th = cfg.thresholds;
const H = "2027-03-15"; // Senin
const TODAY = addDays(H, -4);

/** Terapkan template REGULAR ke tanggal H: milestone & item beserta tenggat yang dihitung. */
function regularProgram() {
  const dues = resolveDueMap(cfg.templates.REGULAR.milestones.map((m) => ({ code: m.code, spec: { anchor: m.anchor, days: m.days, work: m.work, ref: m.ref } })), { h: H, hEnd: H, t: null }, MON_FRI);
  const milestones: MilestoneIn[] = cfg.templates.REGULAR.milestones.map((m) => ({ code: m.code, name: m.name, weight: m.weight, critical: m.critical, due: dues.get(m.code) ?? null, doneAt: null, notApplicable: false }));
  const items: ItemIn[] = cfg.templates.REGULAR.items.map((i) => ({ component: i.component, name: i.name, critical: i.critical, due: resolveOffset({ anchor: i.anchor, days: i.days, work: i.work }, { h: H, hEnd: H, t: null }, () => null, MON_FRI), status: "OPEN" as const }));
  return { dues, milestones, items };
}

describe("contoh perhitungan Bagian 7 (HACCP, H-4)", () => {
  const { dues, milestones, items } = regularProgram();
  // Semua milestone yang tenggatnya lewat selesai tepat waktu KECUALI R06 (jadwal uji LSP, bobot 8, kritikal).
  const ms = milestones.map((m) => ({ ...m, doneAt: m.due !== null && m.due <= TODAY && m.code !== "R06" ? m.due : null }));

  it("Ketepatan Waktu: PV = 50, EV = 42, SPI = 0,84 → Merah (juga karena milestone kritikal overdue)", () => {
    const t = computeTimeliness(ms, TODAY, th);
    expect(t.pv).toBe(50);
    expect(t.ev).toBe(42);
    expect(t.spi).toBeCloseTo(0.84, 10);
    expect(t.bandStatus).toBe("RED");
    expect(t.criticalOverdue).toEqual(["R06"]);
    expect(t.status).toBe("RED");
    expect(t.overdueActive).toBe(1);
    expect(t.oldestOverdueDays).toBe(3); // "jadwal uji LSP terlambat 3 hari"
    expect(t.otr).toBeCloseTo(7 / 8, 10); // 7 dari 8 milestone yang tenggatnya lewat selesai tepat waktu
  });

  const readyItems = (): ItemIn[] => items.map((i) => {
    // Selesai / jatuh tempo / total (dokumen): Instruktur 2/2/3; Materi 3/3/4; Lokasi 1/1/4; Administrasi 0/0/1; Sertifikasi 1/2/3.
    const doneNames = new Set(["Instruktur terkonfirmasi", "Kontrak/honor instruktur disepakati", "Silabus dan RPP final", "Bahan ajar final", "Alat evaluasi pre/post-test siap", "Venue atau tautan kelas siap", "Berkas asesi lengkap"]);
    return { ...i, status: doneNames.has(i.name) ? ("DONE" as const) : ("OPEN" as const) };
  });
  const rampR = participantRamp("REGULAR", TODAY, (c) => dues.get(c) ?? null, cfg.participants);

  it("r_peserta pada H-4 = 1 (tenggat peserta minimum R09 = H-4)", () => { expect(rampR).toBe(1); });

  it("Kesiapan: IKP = 56,0; Target = 65,0; selisih −9,0 → skor saja Kuning, tetapi item kritikal terbuka → Merah", () => {
    const r = computeReadiness({ items: readyItems(), weights: cfg.weights.REGULAR, today: TODAY, h: H, participants: { confirmed: 13, reference: 15, rampR } }, th);
    const byK = Object.fromEntries(r.components.map((c) => [c.component, c]));
    expect([byK.INSTRUCTOR!.done, byK.INSTRUCTOR!.dueApplicable, byK.INSTRUCTOR!.applicable]).toEqual([2, 2, 3]);
    expect([byK.MATERIAL!.done, byK.MATERIAL!.dueApplicable, byK.MATERIAL!.applicable]).toEqual([3, 3, 4]);
    expect([byK.LOGISTICS!.done, byK.LOGISTICS!.dueApplicable, byK.LOGISTICS!.applicable]).toEqual([1, 1, 4]);
    expect([byK.ADMIN!.done, byK.ADMIN!.dueApplicable, byK.ADMIN!.applicable]).toEqual([0, 0, 1]);
    expect([byK.CERTIFICATION!.done, byK.CERTIFICATION!.dueApplicable, byK.CERTIFICATION!.applicable]).toEqual([1, 2, 3]);
    expect(byK.PARTICIPANTS!.score).toBeCloseTo(13 / 15, 10);
    expect(r.ikp).toBeCloseTo(56.0, 1);
    expect(r.target).toBeCloseTo(65.0, 1);
    expect(r.gap).toBeCloseTo(-9.0, 1);
    expect(r.bandStatus).toBe("YELLOW");
    expect(r.criticalOpen).toEqual(["Jadwal uji dari LSP terkonfirmasi"]);
    expect(r.status).toBe("RED");
  });

  it("Proyeksi peserta: 13 + (6/14) × 1 = 13,43 → rasio 0,90 → Kuning", () => {
    const p = computeProjection({ confirmed: 13, recent: 6, today: TODAY, closeDate: addDays(H, -3), reference: 15 }, th)!;
    expect(p.daysLeft).toBe(1);
    expect(p.projection).toBeCloseTo(13 + 6 / 14, 10);
    expect(p.ratio).toBeCloseTo(0.8952, 3);
    expect(p.ratio.toFixed(2)).toBe("0.90");
    expect(p.status).toBe("YELLOW");
  });

  it("Beban: Supervisor 27 jam minggu ini dan 31,5 minggu depan, kapasitas 5 × 6 = 30 → 90% dan 105% → program 105% Kuning", () => {
    const cap = weekCapacity("2027-03-08", MON_FRI, 0, 6);
    expect(cap).toBe(30);
    const pcts = [loadPct(27, cap), loadPct(31.5, cap)];
    expect(pcts).toEqual([90, 105]);
    const prog = programLoad(pcts)!;
    expect(prog).toBe(105);
    expect(loadColor(loadBand(prog, th))).toBe("YELLOW");
  });

  it("Status program = terburuk(Merah; Merah; Kuning) = Merah", () => {
    expect(combineStatus({ timeliness: "RED", readiness: "RED", load: "YELLOW", programTriggers: [] })).toBe("RED");
  });
});

describe("tanggal: offset H±n, hari kerja, rujukan antar-milestone", () => {
  it("WORKDAY/NETWORKDAYS: melompati akhir pekan; 0 hari = tanggal yang sama; mundur", () => {
    expect(addWorkdays("2027-03-12", 2, MON_FRI)).toBe("2027-03-16"); // Jum + 2 hari kerja = Selasa
    expect(addWorkdays("2027-03-15", -1, MON_FRI)).toBe("2027-03-12"); // Sen − 1 = Jum
    expect(addWorkdays("2027-03-13", 0, MON_FRI)).toBe("2027-03-13");
    expect(countWorkdays("2027-03-08", "2027-03-14", MON_FRI)).toBe(5);
    expect(countWorkdays("2027-03-13", "2027-03-14", MON_FRI)).toBe(0); // Sabtu–Minggu
    expect(countWorkdays("2027-03-15", "2027-03-12", MON_FRI)).toBe(0);
    expect(countWorkdays("2027-03-08", "2027-03-12", { workDays: [1, 2, 3, 4, 5], holidays: new Set(["2027-03-10"]) })).toBe(4);
  });

  it("kerjasama: K01 = T + 2 hari kerja; K02 = K01 + 1 hari kerja; K04 = K03 + 2 hari kerja; tanpa H, milestone berbasis H belum terhitung", () => {
    const rows = cfg.templates.PARTNER.milestones.map((m) => ({ code: m.code, spec: { anchor: m.anchor, days: m.days, work: m.work, ref: m.ref } }));
    const onlyT = resolveDueMap(rows, { h: null, hEnd: null, t: "2027-03-11" }, MON_FRI); // Kamis
    expect(onlyT.get("K01")).toBe("2027-03-15");
    expect(onlyT.get("K02")).toBe("2027-03-16");
    expect(onlyT.get("K03")).toBeNull();
    expect(onlyT.get("K04")).toBeNull();
    expect(onlyT.get("K05")).toBeNull(); // manual, belum diisi
    const withH = resolveDueMap(rows, { h: "2027-04-12", hEnd: "2027-04-13", t: "2027-03-11" }, MON_FRI);
    expect(withH.get("K03")).toBe("2027-03-29"); // H-14
    expect(withH.get("K04")).toBe("2027-03-31"); // K03 + 2 hari kerja
    expect(withH.get("K12")).toBe("2027-04-13"); // hari terakhir
    expect(withH.get("K13")).toBe("2027-04-20"); // H+7 dari hari terakhir
  });

  it("rujukan melingkar tidak menggantung: hasilnya null", () => {
    const m = resolveDueMap([{ code: "A", spec: { anchor: "MILESTONE", days: 1, work: false, ref: "B" } }, { code: "B", spec: { anchor: "MILESTONE", days: 1, work: false, ref: "A" } }], { h: H, hEnd: H, t: null }, MON_FRI);
    expect([m.get("A"), m.get("B")]).toEqual([null, null]);
  });

  it("tanggal H berubah → seluruh tenggat ikut bergeser (tenggat tidak disimpan)", () => {
    const a = regularProgram().dues;
    const rows = cfg.templates.REGULAR.milestones.map((m) => ({ code: m.code, spec: { anchor: m.anchor, days: m.days, work: m.work, ref: m.ref } }));
    const b = resolveDueMap(rows, { h: addDays(H, 10), hEnd: addDays(H, 10), t: null }, MON_FRI);
    for (const [code, d] of a) expect(diffDays(b.get(code)!, d!)).toBe(10);
  });
});

describe("Ketepatan Waktu: kasus tepi & ukuran pendukung", () => {
  const m = (code: string, weight: number, due: string | null, doneAt: string | null, over: Partial<MilestoneIn> = {}): MilestoneIn => ({ code, name: code, weight, critical: false, due, doneAt, notApplicable: false, ...over });
  it("PV = 0 (belum ada tenggat lewat): SPI tidak ditampilkan dan status Hijau", () => {
    const t = computeTimeliness([m("A", 10, "2027-04-01", null)], "2027-03-01", th);
    expect(t.pv).toBe(0);
    expect(t.spi).toBeNull();
    expect(t.status).toBe("GREEN");
  });
  it("selesai lebih awal ikut dihitung di EV sehingga SPI dapat > 1", () => {
    const t = computeTimeliness([m("A", 10, "2027-03-01", "2027-03-01"), m("B", 10, "2027-04-01", "2027-02-20")], "2027-03-02", th);
    expect(t.pv).toBe(10);
    expect(t.ev).toBe(20);
    expect(t.spi).toBe(2);
  });
  it("batas warna: ≥ 0,95 Hijau; 0,85–0,94 Kuning; < 0,85 Merah (batas inklusif di sisi atas)", () => {
    const at = (spi: number) => computeTimeliness([m("A", 100, "2027-03-01", null), m("B", 100 * spi, "2027-02-01", "2027-02-01"), m("C", 100 - 100 * spi, "2027-02-01", null)].map((x, i) => (i === 0 ? { ...x, due: "2099-01-01" } : x)), "2027-03-02", th).bandStatus;
    expect(at(0.95)).toBe("GREEN");
    expect(at(0.9499)).toBe("YELLOW");
    expect(at(0.85)).toBe("YELLOW");
    expect(at(0.8499)).toBe("RED");
  });
  it("milestone Tidak berlaku tidak dihitung; OTR, rata-rata keterlambatan, umur overdue terlama, eskalasi > 3 hari", () => {
    const t = computeTimeliness([
      m("A", 10, "2027-03-01", "2027-03-01"), m("B", 10, "2027-03-01", "2027-03-04"), m("C", 10, "2027-03-02", null), m("D", 50, "2027-03-01", null, { notApplicable: true }),
    ], "2027-03-10", th);
    expect(t.pv).toBe(30);
    expect(t.otr).toBeCloseTo(1 / 3, 10);
    expect(t.avgDelayDays).toBeCloseTo((0 + 3) / 2, 10);
    expect(t.overdueActive).toBe(1);
    expect(t.oldestOverdueDays).toBe(8);
    expect(t.escalate).toEqual(["C"]);
  });
  it("ambang dibaca dari konfigurasi (bukan angka tetap): menggeser batas Hijau mengubah status", () => {
    const rows = [m("A", 10, "2027-03-01", "2027-03-01"), m("B", 10, "2027-03-01", null)]; // SPI 0,5
    expect(computeTimeliness(rows, "2027-03-02", th).bandStatus).toBe("RED");
    expect(computeTimeliness(rows, "2027-03-02", { ...th, spi: { greenMin: 0.5, yellowMin: 0.4 } }).bandStatus).toBe("GREEN");
  });
});

describe("Kesiapan: komponen dikeluarkan, normalisasi bobot, pemicu kritikal", () => {
  const item = (component: ItemIn["component"], status: ItemIn["status"], due: string | null, critical = false, name = `${component}-${status}`): ItemIn => ({ component, name, critical, due, status });
  const base = { weights: cfg.weights.REGULAR, today: "2027-03-10", h: "2027-03-20", participants: { confirmed: 0, reference: null, rampR: null } };

  it("tanpa skema BNSP komponen Sertifikasi dikeluarkan dan bobot lain dinormalkan oleh Σw", () => {
    const items: ItemIn[] = [item("INSTRUCTOR", "DONE", "2027-03-01"), item("CERTIFICATION", "NOT_APPLICABLE", "2027-03-01"), item("CERTIFICATION", "NOT_APPLICABLE", "2027-03-02")];
    const r = computeReadiness({ ...base, items }, th);
    expect(r.components.find((c) => c.component === "CERTIFICATION")!.score).toBeNull();
    expect(r.ikp).toBe(100); // hanya Instruktur yang berlaku (Peserta tanpa acuan juga dikeluarkan) → 100
    expect(r.target).toBe(100);
  });
  it("Peserta tanpa acuan (belum ada minimum) dikeluarkan, bukan dihitung 0", () => {
    const r = computeReadiness({ ...base, items: [item("MATERIAL", "OPEN", "2099-01-01")] }, th);
    expect(r.components[0]!.score).toBeNull();
    expect(r.ikp).toBe(0);
  });
  it("selisih ≥ 0 Hijau; −15 s.d. −1 Kuning; < −15 Merah (ambang dari konfigurasi)", () => {
    const at = (done: number, total: number) => {
      const items = Array.from({ length: total }, (_, i) => item("MATERIAL", i < done ? "DONE" : "OPEN", "2000-01-01")).map((x, i) => ({ ...x, name: `m${i}` }));
      return computeReadiness({ ...base, items: items.map((x) => ({ ...x, due: "2099-01-01" })) , participants: base.participants }, th); // tenggat jauh → target 0 → selisih = IKP
    };
    expect(at(0, 4).gap).toBe(0);
    expect(at(0, 4).bandStatus).toBe("GREEN");
    const behind = computeReadiness({ ...base, items: [item("MATERIAL", "OPEN", "2027-03-01"), item("MATERIAL", "OPEN", "2027-03-02"), item("MATERIAL", "DONE", "2099-01-01")] }, th);
    expect(behind.gap!).toBeLessThan(th.readiness.yellowMin);
    expect(behind.bandStatus).toBe("RED");
  });
  it("item kritikal terbuka: Merah bila tenggat lewat ATAU sudah H-1 (walau tenggat belum lewat); selesai/Tidak berlaku tidak memicu", () => {
    const crit = (status: ItemIn["status"], due: string) => computeReadiness({ ...base, items: [item("INSTRUCTOR", status, due, true, "Kritis")] }, th);
    expect(crit("OPEN", "2027-03-09").status).toBe("RED"); // tenggat lewat
    expect(crit("OPEN", "2027-03-12").criticalOpen).toEqual([]); // belum lewat, H-10
    expect(computeReadiness({ ...base, today: "2027-03-19", items: [item("INSTRUCTOR", "OPEN", "2027-03-25", true, "Kritis")] }, th).status).toBe("RED"); // H-1
    expect(crit("DONE", "2027-03-09").criticalOpen).toEqual([]);
    expect(crit("NOT_APPLICABLE", "2027-03-09").criticalOpen).toEqual([]);
  });
  it("r_peserta: reguler naik linear dari tenggat awal ke akhir; kerjasama langkah 0 → 1 pada tenggat daftar peserta", () => {
    const due = (c: string) => ({ R01: "2027-01-10", R09: "2027-02-10", K10: "2027-03-01" } as Record<string, string>)[c] ?? null;
    expect(participantRamp("REGULAR", "2027-01-09", due, cfg.participants)).toBe(0);
    expect(participantRamp("REGULAR", "2027-01-10", due, cfg.participants)).toBe(0);
    expect(participantRamp("REGULAR", "2027-01-26", due, cfg.participants)).toBeCloseTo(16 / 31, 10);
    expect(participantRamp("REGULAR", "2027-03-01", due, cfg.participants)).toBe(1);
    expect(participantRamp("PARTNER", "2027-02-28", due, cfg.participants)).toBe(0);
    expect(participantRamp("PARTNER", "2027-03-01", due, cfg.participants)).toBe(1);
    expect(participantRamp("REGULAR", "2027-01-26", () => null, cfg.participants)).toBeNull();
  });
  it("proyeksi: tanpa acuan/penutupan → tidak ada; setelah tutup pendaftaran hari tersisa 0; ambang Hijau ≥ 1,0 & Merah < 0,8", () => {
    expect(computeProjection({ confirmed: 5, recent: 2, today: "2027-03-01", closeDate: null, reference: 10 }, th)).toBeNull();
    expect(computeProjection({ confirmed: 5, recent: 2, today: "2027-03-01", closeDate: "2027-03-05", reference: 0 }, th)).toBeNull();
    expect(computeProjection({ confirmed: 9, recent: 14, today: "2027-03-06", closeDate: "2027-03-05", reference: 10 }, th)!.daysLeft).toBe(0);
    expect(computeProjection({ confirmed: 10, recent: 0, today: "2027-03-01", closeDate: "2027-03-05", reference: 10 }, th)!.status).toBe("GREEN");
    expect(computeProjection({ confirmed: 7, recent: 0, today: "2027-03-01", closeDate: "2027-03-05", reference: 10 }, th)!.status).toBe("RED");
  });
});

describe("Beban Tim", () => {
  it("jam standar (4.2): jam tetap + jam/peserta × peserta + jam/hari kelas × durasi", () => {
    expect(standardHours({ fixed: 6, perParticipant: 0.1, perClassDay: 1 }, 15, 3)).toBe(10.5);
    expect(standardHours({ fixed: 0, perParticipant: 0, perClassDay: 2 }, 15, 3)).toBe(6);
  });
  it("jam tugas per minggu (4.1): dibagi rata per hari kerja; jumlah semua minggu = jam tugas; tugas akhir pekan = 0", () => {
    const task = { employeeId: "e", hours: 20, start: "2027-03-10", end: "2027-03-19" }; // Rab–Jum minggu berikut = 3 + 5 = 8 hari kerja
    const w1 = taskHoursInWeek(task, "2027-03-08", MON_FRI);
    const w2 = taskHoursInWeek(task, "2027-03-15", MON_FRI);
    expect(w1).toBeCloseTo(20 * 3 / 8, 10);
    expect(w2).toBeCloseTo(20 * 5 / 8, 10);
    expect(w1 + w2).toBeCloseTo(20, 10);
    expect(taskHoursInWeek(task, "2027-03-22", MON_FRI)).toBe(0);
    expect(taskHoursInWeek({ employeeId: "e", hours: 8, start: "2027-03-13", end: "2027-03-14" }, "2027-03-08", MON_FRI)).toBe(0);
  });
  it("kapasitas (4.3): (hari kerja − cuti) × jam efektif; cuti penuh = kapasitas 0 → beban tak terhingga bila ada jam", () => {
    expect(weekCapacity("2027-03-08", MON_FRI, 1, 6)).toBe(24);
    expect(weekCapacity("2027-03-08", MON_FRI, 5, 6)).toBe(0);
    expect(weekCapacity("2027-03-08", MON_FRI, 9, 6)).toBe(0);
    expect(loadPct(4, 0)).toBe(Infinity);
    expect(loadPct(0, 0)).toBe(0);
    expect(loadBand(Infinity, th)).toBe("OVERLOAD");
  });
  it("pita beban pada persen bulat: ≤ 70 ruang; 71–90 ideal; 91–110 padat; > 110 overload", () => {
    const b = (p: number) => loadBand(p, th);
    expect([b(70), b(70.4), b(71), b(90), b(90.4), b(91), b(110), b(110.4), b(111)]).toEqual(["ROOMY", "ROOMY", "IDEAL", "IDEAL", "IDEAL", "BUSY", "BUSY", "BUSY", "OVERLOAD"]);
    expect([loadColor("ROOMY"), loadColor("IDEAL"), loadColor("BUSY"), loadColor("OVERLOAD")]).toEqual(["GREEN", "GREEN", "YELLOW", "RED"]);
  });
  it("pita beban mengikuti konfigurasi (mis. Direktur mengubah batas Kuning menjadi 120)", () => {
    expect(loadBand(115, { ...th, load: { ...th.load, yellowMax: 120 } })).toBe("BUSY");
    expect(loadBand(115, th)).toBe("OVERLOAD");
  });
  it("KP (4.6): hybrid dihitung 2; KP > 1 = ada kelas tanpa pendamping; tanpa fasilitator = tak terhingga; tanpa kelas = 0", () => {
    expect(parallelDensity(["ONSITE", "ONLINE"], 2)).toBe(1);
    expect(parallelDensity(["HYBRID"], 1)).toBe(2);
    expect(parallelDensity(["HYBRID", "ONSITE"], 2)).toBe(1.5);
    expect(parallelDensity(["ONSITE"], 0)).toBe(Infinity);
    expect(parallelDensity([], 0)).toBe(0);
  });
  it("indeks ketimpangan (4.7) = beban tertinggi / rerata divisi; butuh ≥ 2 orang", () => {
    expect(imbalanceIndex([150, 50, 100])).toBeCloseTo(1.5, 10);
    expect(imbalanceIndex([100])).toBeNull();
    expect(imbalanceIndex([0, 0])).toBeNull();
  });
  it("beban program = tertinggi; tanpa pemegang milestone = tidak ada", () => {
    expect(programLoad([40, 120, 95])).toBe(120);
    expect(programLoad([])).toBeNull();
  });
});

describe("status gabungan & konfigurasi", () => {
  it("terburuk dari tiga indikator; pemicu program (KP > 1, proyeksi rendah) langsung Merah", () => {
    expect(worst("GREEN", "YELLOW", null)).toBe("YELLOW");
    expect(worst(null, null)).toBeNull();
    expect(combineStatus({ timeliness: "GREEN", readiness: "GREEN", load: "YELLOW", programTriggers: [] })).toBe("YELLOW");
    expect(combineStatus({ timeliness: "GREEN", readiness: "GREEN", load: null, programTriggers: [] })).toBe("GREEN");
    expect(combineStatus({ timeliness: "GREEN", readiness: "GREEN", load: "GREEN", programTriggers: ["PARALLEL_DENSITY"] })).toBe("RED");
  });

  it("konfigurasi bawaan (dokumen v1.0) sah, bobot milestone & komponen berjumlah 100, tanpa galat maupun peringatan", () => {
    expect(indicatorConfigSchema.safeParse(cfg).success).toBe(true);
    expect(checkIndicatorConfig(cfg)).toEqual({ errors: [], warnings: [] });
    for (const t of TRACKS) expect(cfg.templates[t].milestones.reduce((a, x) => a + x.weight, 0)).toBe(100);
    expect(cfg.templates.REGULAR.milestones).toHaveLength(16);
    expect(cfg.templates.PARTNER.milestones).toHaveLength(18);
    expect(cfg.hourTable.length).toBeGreaterThanOrEqual(9);
  });

  it("validasi konfigurasi: urutan ambang, kode kembar, rujukan tak sah, jabatan tak dikenal → galat; bobot ≠ 100 → peringatan saja", () => {
    const mut = (f: (c: ReturnType<typeof defaultIndicatorConfig>) => void) => { const c = defaultIndicatorConfig(); f(c); return checkIndicatorConfig(c); };
    expect(mut((c) => { c.thresholds.spi.greenMin = 0.8; }).errors.join()).toContain("Ketepatan Waktu");
    expect(mut((c) => { c.thresholds.load.roomyMax = 95; }).errors.join()).toContain("Beban");
    expect(mut((c) => { c.templates.REGULAR.milestones[1]!.code = "R01"; }).errors.join()).toContain("kembar");
    expect(mut((c) => { c.templates.PARTNER.milestones[1]!.ref = "K99"; }).errors.join()).toContain("tidak sah");
    expect(mut((c) => { c.templates.REGULAR.milestones[0]!.roleKey = "TIDAK_ADA"; }).errors.join()).toContain("TIDAK_ADA");
    expect(mut((c) => { c.participants.rampEndCode = "R99"; }).errors.join()).toContain("Peserta");
    const w = mut((c) => { c.templates.REGULAR.milestones[0]!.weight = 9; c.weights.PARTNER.MATERIAL = 25; });
    expect(w.errors).toEqual([]);
    expect(w.warnings).toHaveLength(2);
  });
});
