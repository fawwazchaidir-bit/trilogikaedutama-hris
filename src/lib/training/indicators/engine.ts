/**
 * Mesin hitung indikator pemantauan — MURNI (tanpa database/jam sistem), mengikuti dokumen "Indikator Pemantauan Program Pelatihan" v1.0.
 * Nomor persamaan mengacu ke dokumen. Tidak ada angka tetap di sini: semua ambang/bobot berasal dari IndicatorConfig (dapat diubah Direktur).
 */
import { addDays, diffDays, endOfIsoWeek, isoWeekday, startOfIsoWeek } from "@/lib/time";
import type { Anchor, IndicatorConfig, ItemComponent, Component } from "./config";

export type Color = "GREEN" | "YELLOW" | "RED";
const RANK: Record<Color, number> = { GREEN: 0, YELLOW: 1, RED: 2 };
export const COLOR_LABEL: Record<Color, string> = { GREEN: "Hijau", YELLOW: "Kuning", RED: "Merah" };
export function worst(...cs: (Color | null | undefined)[]): Color | null {
  let out: Color | null = null;
  for (const c of cs) if (c && (out === null || RANK[c] > RANK[out])) out = c;
  return out;
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ═════════════════════════ Tanggal: offset H±n, hari kerja ═════════════════════════

export interface WorkCal { workDays: readonly number[]; holidays?: ReadonlySet<string> }
export const MON_FRI: WorkCal = { workDays: [1, 2, 3, 4, 5] };
export const isWorkday = (iso: string, cal: WorkCal): boolean => cal.workDays.includes(isoWeekday(iso)) && !cal.holidays?.has(iso);

/** WORKDAY: geser `n` hari kerja (boleh negatif). n = 0 mengembalikan tanggal yang sama. */
export function addWorkdays(iso: string, n: number, cal: WorkCal): string {
  if (n === 0 || cal.workDays.length === 0) return iso;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let d = iso;
  for (let guard = 0; left > 0 && guard < 5000; guard++) { d = addDays(d, step); if (isWorkday(d, cal)) left--; }
  return d;
}

/** NETWORKDAYS: jumlah hari kerja dari `from` sampai `to` (inklusif); 0 bila `to` < `from`. */
export function countWorkdays(from: string, to: string, cal: WorkCal): number {
  const n = diffDays(to, from) + 1;
  if (n <= 0) return 0;
  let c = 0;
  for (let i = 0; i < Math.min(n, 3700); i++) if (isWorkday(addDays(from, i), cal)) c++;
  return c;
}

export interface DateContext { h: string | null; hEnd: string | null; t: string | null }
export interface OffsetSpec { anchor: Anchor; days: number; work: boolean; ref?: string | null; manualDate?: string | null }

/** Tenggat = tanggal acuan (H, hari terakhir, T, tenggat milestone lain, atau manual) + offset. Null bila acuan belum diketahui. */
export function resolveOffset(spec: OffsetSpec, ctx: DateContext, dueOf: (code: string) => string | null, cal: WorkCal): string | null {
  let base: string | null;
  switch (spec.anchor) {
    case "H": base = ctx.h; break;
    case "H_END": base = ctx.hEnd ?? ctx.h; break;
    case "T": base = ctx.t; break;
    case "MILESTONE": base = spec.ref ? dueOf(spec.ref) : null; break;
    case "MANUAL": return spec.manualDate ?? null;
  }
  if (!base) return null;
  return spec.work ? addWorkdays(base, spec.days, cal) : addDays(base, spec.days);
}

/** Hitung tenggat banyak milestone yang bisa saling merujuk (K02 → K01, K04 → K03). Rujukan melingkar = tidak terhitung (null). */
export function resolveDueMap(rows: { code: string; spec: OffsetSpec }[], ctx: DateContext, cal: WorkCal): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const visiting = new Set<string>();
  const dueOf = (code: string): string | null => {
    if (out.has(code)) return out.get(code)!;
    const row = byCode.get(code);
    if (!row || visiting.has(code)) return null;
    visiting.add(code);
    const v = resolveOffset(row.spec, ctx, dueOf, cal);
    visiting.delete(code);
    out.set(code, v);
    return v;
  };
  for (const r of rows) dueOf(r.code);
  return out;
}

// ═════════════════════════ 2. Ketepatan Waktu (SPI) ═════════════════════════

export interface MilestoneIn { code: string; name: string; weight: number; critical: boolean; due: string | null; doneAt: string | null; notApplicable: boolean }
export interface TimelinessResult {
  /** Status akhir indikator = terburuk(skor SPI, pemicu Merah). */
  status: Color;
  /** Status dari skor SPI saja. */
  bandStatus: Color;
  pv: number; ev: number;
  /** null bila PV = 0 (belum ada tenggat yang lewat): tidak ditampilkan dan dianggap Hijau. */
  spi: number | null;
  /** Tingkat tepat waktu (OTR). */
  otr: number | null;
  avgDelayDays: number | null;
  overdueActive: number;
  oldestOverdueDays: number | null;
  criticalOverdue: string[];
  /** Milestone overdue lebih dari ambang eskalasi (kode). */
  escalate: string[];
}

export function computeTimeliness(rows: MilestoneIn[], today: string, th: IndicatorConfig["thresholds"]): TimelinessResult {
  const live = rows.filter((m) => !m.notApplicable && m.due !== null);
  // (2.1) PV(t) = Σ bobot_i, tenggat_i ≤ t      (2.2) EV(t) = Σ bobot_i, selesai_i ≤ t (selesai lebih awal ikut dihitung)
  const pv = live.filter((m) => m.due! <= today).reduce((a, m) => a + m.weight, 0);
  const ev = live.filter((m) => m.doneAt !== null && m.doneAt <= today).reduce((a, m) => a + m.weight, 0);
  // (2.3) SPI = EV / PV
  const spi = pv === 0 ? null : ev / pv;
  const bandStatus: Color = spi === null ? "GREEN" : spi >= th.spi.greenMin ? "GREEN" : spi >= th.spi.yellowMin ? "YELLOW" : "RED";

  const dueNow = live.filter((m) => m.due! <= today);
  const onTime = dueNow.filter((m) => m.doneAt !== null && m.doneAt <= m.due!).length;
  const done = live.filter((m) => m.doneAt !== null);
  const overdue = live.filter((m) => m.due! < today && m.doneAt === null);
  const oldest = overdue.length ? Math.max(...overdue.map((m) => diffDays(today, m.due!))) : null;
  const criticalOverdue = overdue.filter((m) => m.critical).map((m) => m.code);
  return {
    status: criticalOverdue.length ? "RED" : bandStatus, bandStatus, pv, ev, spi,
    otr: dueNow.length ? onTime / dueNow.length : null,
    avgDelayDays: done.length ? done.reduce((a, m) => a + Math.max(0, m.due ? diffDays(m.doneAt!, m.due) : 0), 0) / done.length : null,
    overdueActive: overdue.length, oldestOverdueDays: oldest, criticalOverdue,
    escalate: overdue.filter((m) => diffDays(today, m.due!) > th.overdueEscalationDays).map((m) => m.code),
  };
}

// ═════════════════════════ 3. Kesiapan (IKP) ═════════════════════════

export type ItemStatus = "OPEN" | "DONE" | "NOT_APPLICABLE";
export interface ItemIn { component: ItemComponent; name: string; critical: boolean; due: string | null; status: ItemStatus }
export interface ComponentScore {
  component: Component; weight: number;
  /** s_k (3.1/3.2); null = komponen dikeluarkan (tidak ada item berlaku / tidak ada acuan). */
  score: number | null;
  /** r_k(t) (3.4/3.6). */
  target: number | null;
  applicable: number; done: number; dueApplicable: number;
}
export interface ReadinessResult {
  status: Color; bandStatus: Color;
  ikp: number | null; target: number | null;
  /** (3.7) Selisih Kesiapan = IKP − Target(t), dalam poin. */
  gap: number | null;
  components: ComponentScore[];
  criticalOpen: string[];
}

export function computeReadiness(p: {
  items: ItemIn[]; weights: Record<Component, number>; today: string; h: string | null;
  participants: { confirmed: number; reference: number | null; rampR: number | null };
}, th: IndicatorConfig["thresholds"]): ReadinessResult {
  const components: ComponentScore[] = [];
  for (const k of ["PARTICIPANTS", "INSTRUCTOR", "MATERIAL", "LOGISTICS", "ADMIN", "CERTIFICATION"] as const) {
    const weight = p.weights[k];
    if (k === "PARTICIPANTS") {
      // (3.2) s_peserta = min(1, terkonfirmasi / acuan); target = r_peserta(t) (3.6)
      const ref = p.participants.reference;
      components.push(ref && ref > 0
        ? { component: k, weight, score: Math.min(1, p.participants.confirmed / ref), target: p.participants.rampR ?? 0, applicable: ref, done: p.participants.confirmed, dueApplicable: 0 }
        : { component: k, weight, score: null, target: null, applicable: 0, done: 0, dueApplicable: 0 });
      continue;
    }
    const applicable = p.items.filter((i) => i.component === k && i.status !== "NOT_APPLICABLE");
    const done = applicable.filter((i) => i.status === "DONE").length;
    const dueApplicable = applicable.filter((i) => i.due !== null && i.due <= p.today).length;
    // (3.1) s_k = item selesai / item berlaku     (3.4) r_k(t) = item berlaku dengan tenggat ≤ t / item berlaku
    components.push(applicable.length === 0
      ? { component: k, weight, score: null, target: null, applicable: 0, done: 0, dueApplicable: 0 }
      : { component: k, weight, score: done / applicable.length, target: dueApplicable / applicable.length, applicable: applicable.length, done, dueApplicable });
  }
  const used = components.filter((c) => c.score !== null && c.weight > 0);
  const sw = used.reduce((a, c) => a + c.weight, 0);
  // (3.3) IKP = 100 × Σ w·s / Σ w     (3.5) Target(t) = 100 × Σ w·r / Σ w   (komponen tanpa item berlaku dikeluarkan dari pembagi)
  const ikp = sw > 0 ? (100 * used.reduce((a, c) => a + c.weight * c.score!, 0)) / sw : null;
  const target = sw > 0 ? (100 * used.reduce((a, c) => a + c.weight * (c.target ?? 0), 0)) / sw : null;
  const gap = ikp !== null && target !== null ? ikp - target : null;
  const bandStatus: Color = gap === null ? "GREEN" : gap >= th.readiness.greenMin ? "GREEN" : gap >= th.readiness.yellowMin ? "YELLOW" : "RED";
  // Pemicu Merah: item kritikal belum selesai saat tenggatnya lewat, atau masih terbuka pada H-1.
  const h1 = p.h ? addDays(p.h, -1) : null;
  const criticalOpen = p.items.filter((i) => i.critical && i.status === "OPEN" && ((i.due !== null && i.due < p.today) || (h1 !== null && p.today >= h1))).map((i) => i.name);
  return { status: criticalOpen.length ? "RED" : bandStatus, bandStatus, ikp, target, gap, components, criticalOpen };
}

/** (3.6) r_peserta(t): reguler naik bertahap dari tenggat milestone awal ke akhir; kerjasama 0 sebelum tenggat daftar peserta dan 1 sesudahnya. */
export function participantRamp(track: "REGULAR" | "PARTNER", today: string, due: (code: string) => string | null, p: IndicatorConfig["participants"]): number | null {
  if (track === "PARTNER") { const d = due(p.partnerDeadlineCode); return d === null ? null : today >= d ? 1 : 0; }
  const s = due(p.rampStartCode), e = due(p.rampEndCode);
  if (s === null || e === null) return null;
  if (e <= s) return today >= e ? 1 : 0;
  return Math.min(1, Math.max(0, diffDays(today, s) / diffDays(e, s)));
}

export interface ProjectionResult { projection: number; ratio: number; daysLeft: number; status: Color }

/** (3.8)(3.9) Proyeksi = peserta sekarang + (pendaftar dalam n hari terakhir / n) × hari tersisa sampai tutup pendaftaran; Rasio = Proyeksi / peserta minimum. */
export function computeProjection(p: { confirmed: number; recent: number; today: string; closeDate: string | null; reference: number | null }, th: IndicatorConfig["thresholds"]): ProjectionResult | null {
  if (!p.reference || p.reference <= 0 || !p.closeDate) return null;
  const daysLeft = Math.max(0, diffDays(p.closeDate, p.today));
  const projection = p.confirmed + (p.recent / th.projection.windowDays) * daysLeft;
  const ratio = projection / p.reference;
  return { projection, ratio, daysLeft, status: ratio >= th.projection.greenMin ? "GREEN" : ratio >= th.projection.yellowMin ? "YELLOW" : "RED" };
}

// ═════════════════════════ 4. Beban Tim ═════════════════════════

export interface WorkTaskIn { employeeId: string; hours: number; start: string; end: string }

/** Tentukan jam dari tabel jam standar (4.2): jam tetap + jam/peserta × peserta + jam/hari kelas × durasi hari. */
export function standardHours(row: { fixed: number; perParticipant: number; perClassDay: number }, participants: number, classDays: number): number {
  return round(row.fixed + row.perParticipant * participants + row.perClassDay * classDays, 2);
}

/** (4.1) Jam tugas j di minggu m = jam standar × hari kerja tugas yang jatuh di minggu itu / total hari kerja tugas. */
export function taskHoursInWeek(t: WorkTaskIn, weekStart: string, cal: WorkCal): number {
  const total = countWorkdays(t.start, t.end, cal);
  if (total === 0) return 0;
  const from = t.start > weekStart ? t.start : weekStart;
  const wEnd = endOfIsoWeek(weekStart);
  const to = t.end < wEnd ? t.end : wEnd;
  return (t.hours * countWorkdays(from, to, cal)) / total;
}

/** (4.3) Kapasitas = (hari kerja minggu m − hari cuti) × jam efektif per hari. */
export function weekCapacity(weekStart: string, cal: WorkCal, leaveDays: number, hoursPerDay: number): number {
  const days = countWorkdays(weekStart, endOfIsoWeek(weekStart), cal);
  return Math.max(0, days - leaveDays) * hoursPerDay;
}

/** (4.4) Beban = 100% × jam / kapasitas. Kapasitas 0 dengan jam > 0 = tak terhingga (overload). */
export function loadPct(hours: number, capacity: number): number {
  if (capacity <= 0) return hours > 0 ? Number.POSITIVE_INFINITY : 0;
  return (100 * hours) / capacity;
}

export type LoadBand = "ROOMY" | "IDEAL" | "BUSY" | "OVERLOAD";
export const LOAD_BAND_LABEL: Record<LoadBand, string> = { ROOMY: "Ada ruang", IDEAL: "Ideal", BUSY: "Padat — pantau", OVERLOAD: "Overload" };
/** Pita beban: dibandingkan dalam persen bulat (pita di dokumen berupa bilangan bulat: 71–90, 91–110). */
export function loadBand(pct: number, th: IndicatorConfig["thresholds"]): LoadBand {
  if (!Number.isFinite(pct)) return "OVERLOAD";
  const r = Math.round(pct);
  return r <= th.load.roomyMax ? "ROOMY" : r <= th.load.greenMax ? "IDEAL" : r <= th.load.yellowMax ? "BUSY" : "OVERLOAD";
}
export const loadColor = (b: LoadBand): Color => (b === "OVERLOAD" ? "RED" : b === "BUSY" ? "YELLOW" : "GREEN");

/** (4.5) Beban program = beban tertinggi dari staf pemegang milestone, pada minggu berjalan dan minggu berikutnya. */
export function programLoad(pcts: number[]): number | null {
  return pcts.length ? Math.max(...pcts) : null;
}

/** (4.6) KP_d = (luring + daring + 2 × hybrid) / fasilitator tersedia. Fasilitator 0 dengan kelas > 0 = tak terhingga. */
export function parallelDensity(modes: ("ONSITE" | "ONLINE" | "HYBRID")[], facilitators: number): number {
  const load = modes.reduce((a, m) => a + (m === "HYBRID" ? 2 : 1), 0);
  if (load === 0) return 0;
  return facilitators <= 0 ? Number.POSITIVE_INFINITY : load / facilitators;
}

/** (4.7) Indeks Ketimpangan = beban tertinggi / rerata beban divisi. Butuh ≥ 2 orang dan rerata > 0. */
export function imbalanceIndex(loads: number[]): number | null {
  if (loads.length < 2) return null;
  const finite = loads.map((l) => (Number.isFinite(l) ? l : 999));
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  return mean > 0 ? Math.max(...finite) / mean : null;
}

export const weekStartOf = (iso: string): string => startOfIsoWeek(iso);

// ═════════════════════════ 5. Status gabungan ═════════════════════════

export type TriggerCode = "CRITICAL_MILESTONE" | "CRITICAL_ITEM" | "PARALLEL_DENSITY" | "PROJECTION_LOW";
export const TRIGGER_LABEL: Record<TriggerCode, string> = {
  CRITICAL_MILESTONE: "Milestone kritikal lewat tenggat dan belum selesai",
  CRITICAL_ITEM: "Item kesiapan kritikal belum selesai (tenggat lewat atau sudah H-1)",
  PARALLEL_DENSITY: "Kepadatan kelas paralel melebihi fasilitator tersedia",
  PROJECTION_LOW: "Pemeriksaan pendaftar (H-4): rasio proyeksi peserta terlalu rendah",
};

/** (5.1) Status = terburuk(Ketepatan Waktu; Kesiapan; Beban), dan pemicu Merah langsung menetapkan Merah. */
export function combineStatus(p: { timeliness: Color; readiness: Color; load: Color | null; programTriggers: TriggerCode[] }): Color {
  return p.programTriggers.length ? "RED" : worst(p.timeliness, p.readiness, p.load) ?? "GREEN";
}

export const roundTo = round;
