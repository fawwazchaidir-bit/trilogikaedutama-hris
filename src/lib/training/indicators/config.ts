/**
 * Konfigurasi indikator pemantauan — SATU-SATUNYA tempat angka (ambang warna, bobot, template, jam standar) berada.
 * Rumus ada di engine.ts dan tidak memuat angka tetap; semuanya dibaca dari konfigurasi ini, yang disimpan di database
 * (berversi) dan dapat diubah Direktur tanpa programmer. Nilai bawaan = dokumen "Indikator Pemantauan Program Pelatihan" v1.0
 * (4 November 2026). Batas warna di dokumen adalah USULAN AWAL yang ditinjau setelah tiga bulan data berjalan.
 */
import { z } from "zod";

export const TRACKS = ["REGULAR", "PARTNER"] as const;
export type Track = (typeof TRACKS)[number];
export const TRACK_LABEL: Record<Track, string> = { REGULAR: "Reguler (B2C)", PARTNER: "Kerjasama (B2B/B2G)" };

export const ANCHORS = ["H", "H_END", "T", "MILESTONE", "MANUAL"] as const;
export type Anchor = (typeof ANCHORS)[number];
export const ANCHOR_LABEL: Record<Anchor, string> = {
  H: "H (hari pertama)", H_END: "Hari terakhir", T: "T (permintaan klien masuk)", MILESTONE: "Tenggat milestone lain", MANUAL: "Diisi manual",
};

/** Komponen IKP. PARTICIPANTS dihitung dari jumlah (bukan checklist) sehingga tidak punya item. */
export const COMPONENTS = ["PARTICIPANTS", "INSTRUCTOR", "MATERIAL", "LOGISTICS", "ADMIN", "CERTIFICATION"] as const;
export type Component = (typeof COMPONENTS)[number];
export const ITEM_COMPONENTS = ["INSTRUCTOR", "MATERIAL", "LOGISTICS", "ADMIN", "CERTIFICATION"] as const;
export type ItemComponent = (typeof ITEM_COMPONENTS)[number];
export const COMPONENT_LABEL: Record<Component, string> = {
  PARTICIPANTS: "Peserta", INSTRUCTOR: "Instruktur", MATERIAL: "Materi & kurikulum", LOGISTICS: "Lokasi, platform & logistik",
  ADMIN: "Administrasi & kontrak", CERTIFICATION: "Sertifikasi (skema BNSP)",
};

const uuid = z.string().uuid();
const finite = (min: number, max: number) => z.number().finite().min(min).max(max);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const text = (max: number) => z.string().trim().min(1).max(max);

const offsetFields = {
  anchor: z.enum(ANCHORS),
  /** n pada H-n / H+n (negatif = sebelum). */
  days: int(-730, 730),
  /** true = hari kerja (Senin–Jumat), false = hari kalender. */
  work: z.boolean(),
  /** Kode milestone acuan (anchor = MILESTONE). */
  ref: z.string().trim().max(20).nullish(),
};

export const milestoneTemplateSchema = z.object({
  code: text(20), name: text(200), ...offsetFields,
  roleKey: z.string().trim().max(40).nullish(),
  weight: int(0, 1000), critical: z.boolean(), bnspOnly: z.boolean(),
  reference: z.string().trim().max(80).nullish(),
});
export type MilestoneTemplate = z.infer<typeof milestoneTemplateSchema>;

export const itemTemplateSchema = z.object({
  component: z.enum(ITEM_COMPONENTS), name: text(200), ...offsetFields,
  roleKey: z.string().trim().max(40).nullish(),
  critical: z.boolean(), bnspOnly: z.boolean(),
});
export type ItemTemplate = z.infer<typeof itemTemplateSchema>;

const anchorDays = z.object({ anchor: z.enum(["H", "H_END", "T"]), days: int(-730, 730) });
/**
 * ID TETAP baris tabel jam standar (identitas "asal template" sebuah tugas jam kerja). Tidak diturunkan dari nama, urutan, jam, atau pemegang jabatan —
 * semuanya boleh berubah tanpa mengganti ID. Baris baru di editor diberi ID acak sekali dan dibawa terus pada setiap versi konfigurasi.
 */
export const HOUR_ID_RE = /^[A-Za-z0-9_-]{1,60}$/;
export const hourRowSchema = z.object({
  id: z.string().trim().regex(HOUR_ID_RE, "ID baris jam: huruf, angka, - dan _ (maks. 60)"),
  roleKey: text(40), task: text(200),
  tracks: z.array(z.enum(TRACKS)).min(1),
  /** Jam tetap per program, menurut jenis program (Reguler / Kerjasama). */
  fixed: z.object({ REGULAR: finite(0, 1000), PARTNER: finite(0, 1000) }),
  perParticipant: finite(0, 100), perClassDay: finite(0, 100),
  /** Kosong = semua moda. Mis. Supervisor IT hanya untuk daring/hybrid. */
  modes: z.array(z.enum(["ONSITE", "ONLINE", "HYBRID"])),
  start: anchorDays, end: anchorDays,
});
export type HourRow = z.infer<typeof hourRowSchema>;

/**
 * Eskalasi & pengingat otomatis (dokumen §5.2). Penerima ditentukan lewat JABATAN → pemegang jabatan (bukan nama orang), sehingga
 * pergantian orang cukup diubah di "Pemegang jabatan". Garis atasan (`reportsTo`) adalah USULAN dari bagan organisasi — HRIS belum menyimpan atasan langsung.
 */
export const escalationSchema = z.object({
  /** Kirim notifikasi eskalasi otomatis (Kuning/Merah/terlambat/overload). */
  enabled: z.boolean(),
  /** "Kuning n hari kerja berturut-turut" → atasan langsung PIC diberi tahu & rencana pemulihan ditulis di portal. */
  yellowStreakDays: int(2, 10),
  /** Merah pada H-n s.d. H-1 → keputusan Go/No-Go atau penjadwalan ulang. */
  redLateWindowDays: int(1, 30),
  /** Pengingat tenggat tugas/milestone/item kesiapan/pelaksanaan program. */
  reminders: z.object({ dayBefore: z.boolean(), dayOf: z.boolean(), programStart: z.boolean() }),
  /** Kunci jabatan → kunci jabatan atasan langsungnya (null = tanpa atasan di portal → Direktur/Super Admin). */
  reportsTo: z.record(z.string(), z.string().nullable()),
  /** Merah: pelaksanaan → jabatan ini; pemasaran/klien → jabatan berikutnya; keduanya selalu + jabatan "selalu". */
  redExecutionRole: text(40), redMarketingRole: text(40), redAlwaysRole: text(40),
  /** Jabatan yang dianggap pemilik urusan pemasaran/klien (penentu Merah "pemasaran/klien"). */
  marketingRoleKeys: z.array(text(40)).max(20),
  /** Beban staf > ambang dua minggu berturut-turut → jabatan ini. */
  overloadRole: text(40),
});
export type Escalation = z.infer<typeof escalationSchema>;

export function defaultEscalation(): Escalation {
  return {
    enabled: true, yellowStreakDays: 2, redLateWindowDays: 7,
    reminders: { dayBefore: true, dayOf: true, programStart: true },
    reportsTo: {
      SPV_CURRICULUM: "MANAGER_OPS", STAFF_CURRICULUM: "SPV_CURRICULUM", STAFF_GENERAL: "SPV_CURRICULUM", FACILITATOR: "SPV_CURRICULUM",
      STAFF_FINANCE: "MANAGER_OPS", SPV_IT: "MANAGER_OPS",
      STAFF_SOCIAL: "MANAGER_MARKETING", STAFF_ADMISI_1: "MANAGER_MARKETING", STAFF_ADMISI_2: "MANAGER_MARKETING",
      MANAGER_MARKETING: null, MANAGER_OPS: null,
    },
    redExecutionRole: "SPV_CURRICULUM", redMarketingRole: "MANAGER_MARKETING", redAlwaysRole: "MANAGER_OPS",
    marketingRoleKeys: ["MANAGER_MARKETING", "STAFF_SOCIAL", "STAFF_ADMISI_1", "STAFF_ADMISI_2"],
    overloadRole: "MANAGER_OPS",
  };
}

const weights = z.object({ PARTICIPANTS: finite(0, 1000), INSTRUCTOR: finite(0, 1000), MATERIAL: finite(0, 1000), LOGISTICS: finite(0, 1000), ADMIN: finite(0, 1000), CERTIFICATION: finite(0, 1000) });

export const indicatorConfigSchema = z.object({
  thresholds: z.object({
    /** Ketepatan Waktu: SPI ≥ greenMin Hijau; ≥ yellowMin Kuning; selain itu Merah. */
    spi: z.object({ greenMin: finite(0, 5), yellowMin: finite(0, 5) }),
    /** Kesiapan: selisih IKP − Target (poin) ≥ greenMin Hijau; ≥ yellowMin Kuning; selain itu Merah. */
    readiness: z.object({ greenMin: finite(-100, 100), yellowMin: finite(-100, 100) }),
    /** Beban (% dibulatkan): ≤ roomyMax "ada ruang"; ≤ greenMax Hijau; ≤ yellowMax Kuning; selain itu Merah (overload). */
    load: z.object({ roomyMax: finite(0, 500), greenMax: finite(0, 500), yellowMax: finite(0, 500) }),
    /**
     * Penanda "Perlu dicek" pada peta beban: beban jam standar minggu ini masih "Ada ruang", tetapi staf punya ≥ `openMin` tugas operasional terbuka ATAU ≥ `overdueMin` tugas terlambat.
     * Angka awal hanyalah usulan (ditinjau setelah 1–2 bulan pemakaian). Penanda hanya meminta PIC/atasan memeriksa — tidak mengubah status program dan bukan penilaian kinerja.
     * Konfigurasi tersimpan sebelum ada bagian ini memakai nilai bawaan.
     */
    operational: z.object({ openMin: int(1, 100), overdueMin: int(1, 100) }).default({ openMin: 5, overdueMin: 1 }),
    /** Rasio proyeksi peserta (reguler). */
    projection: z.object({
      greenMin: finite(0, 10), yellowMin: finite(0, 10),
      windowDays: int(1, 90), defaultCloseDaysBeforeH: int(0, 60),
      /** Mulai H-n (pemeriksaan pendaftar), rasio < yellowMin langsung Merah. */
      triggerDaysBeforeH: int(0, 60),
    }),
    /** KP di atas nilai ini = kelas tanpa pendamping → Merah. */
    parallelDensityMax: finite(0, 10),
    /** Indeks ketimpangan beban per divisi di atas nilai ini ditandai. */
    imbalanceMax: finite(0, 10),
    /** Milestone overdue lebih dari n hari ditandai untuk eskalasi. */
    overdueEscalationDays: int(0, 365),
  }),
  capacity: z.object({
    hoursPerDay: finite(0.5, 24), workDays: z.array(int(1, 7)).min(1).max(7),
    /** Ambil cuti disetujui dari HRIS untuk mengurangi kapasitas (hanya jumlah hari yang dipakai). */
    useHrisLeave: z.boolean(),
    /** Hari libur kalender HRIS tidak dihitung sebagai hari kerja. Dokumen memakai NETWORKDAYS tanpa hari libur, jadi bawaan false. */
    skipHolidays: z.boolean(),
    /** Minggu ke depan yang dihitung selain minggu berjalan. */
    weeksAhead: int(0, 12),
  }),
  weights: z.object({ REGULAR: weights, PARTNER: weights }),
  participants: z.object({
    /** Program reguler: r_peserta naik dari tenggat milestone mulai sampai tenggat milestone akhir (persamaan 3.6). */
    rampStartCode: text(20), rampEndCode: text(20),
    /** Program kerjasama: r_peserta = 0 sebelum tenggat milestone ini, 1 sesudahnya. */
    partnerDeadlineCode: text(20),
  }),
  templates: z.object({
    REGULAR: z.object({ milestones: z.array(milestoneTemplateSchema).max(60), items: z.array(itemTemplateSchema).max(80) }),
    PARTNER: z.object({ milestones: z.array(milestoneTemplateSchema).max(60), items: z.array(itemTemplateSchema).max(80) }),
  }),
  hourTable: z.array(hourRowSchema).max(60),
  roles: z.array(z.object({ key: text(40).regex(/^[A-Z0-9_]+$/, "Kunci jabatan: huruf besar, angka, underscore"), label: text(80) })).min(1).max(40),
  /** Pemegang jabatan (karyawan). Dipakai untuk menentukan PIC milestone & staf pemegang tugas beban kerja. */
  roleHolders: z.record(z.string(), uuid.nullable()),
  /** Karyawan yang menjadi fasilitator kelas (penyebut KP). */
  facilitators: z.array(uuid).max(60),
  /** Milestone tidak dianggap selesai tanpa bukti (tautan dokumen/referensi). */
  requireEvidence: z.boolean(),
  /** Terapkan template pemantauan otomatis saat proyek dibuat. */
  autoApplyOnCreate: z.boolean(),
  /** Konfigurasi tersimpan sebelum fitur eskalasi tidak memuat bagian ini → memakai nilai bawaan. */
  escalation: escalationSchema.default(() => defaultEscalation()),
});
export type IndicatorConfig = z.infer<typeof indicatorConfigSchema>;

// ───────────────────────────── Nilai bawaan (dokumen v1.0) ─────────────────────────────

const R = { MM: "MANAGER_MARKETING", MO: "MANAGER_OPS", SC: "SPV_CURRICULUM", TC: "STAFF_CURRICULUM", TU: "STAFF_GENERAL", TK: "STAFF_FINANCE", A1: "STAFF_ADMISI_1", FA: "FACILITATOR" } as const;

const ms = (code: string, name: string, anchor: Anchor, days: number, work: boolean, roleKey: string, weight: number, critical: boolean, reference: string, extra: Partial<MilestoneTemplate> = {}): MilestoneTemplate =>
  ({ code, name, anchor, days, work, ref: null, roleKey, weight, critical, bnspOnly: false, reference, ...extra });
const it = (component: ItemTemplate["component"], name: string, anchor: Anchor, days: number, roleKey: string, critical = false, extra: Partial<ItemTemplate> = {}): ItemTemplate =>
  ({ component, name, anchor, days, work: false, ref: null, roleKey, critical, bnspOnly: false, ...extra });
const hr = (id: string, roleKey: string, task: string, tracks: Track[], fixedR: number, fixedP: number, perParticipant: number, perClassDay: number, start: HourRow["start"], end: HourRow["end"], modes: HourRow["modes"] = []): HourRow =>
  ({ id, roleKey, task, tracks, fixed: { REGULAR: fixedR, PARTNER: fixedP }, perParticipant, perClassDay, modes, start, end });

/** ID baru untuk baris tabel jam yang ditambahkan di editor (acak, dibuat SEKALI). */
export function newHourRowId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return `h-${(c?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
}

const fnv1a = (str: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
};

/**
 * Lengkapi ID pada baris tabel jam yang belum punya (konfigurasi tersimpan SEBELUM ada ID, atau dikirim klien lama). Baris yang cocok dengan baris bawaan
 * (jabatan + nama tugas yang sama) memakai ID bawaannya; sisanya mendapat ID turunan isi (stabil selama belum diedit) — setelah disimpan, ID itulah yang
 * dibawa terus. Fungsi murni; tidak mengubah baris yang sudah punya ID.
 */
export function fillHourIds<T>(rawConfig: T): T {
  const cfg = rawConfig as { hourTable?: unknown } | null;
  if (!cfg || typeof cfg !== "object" || !Array.isArray(cfg.hourTable)) return rawConfig;
  const defaults = new Map(defaultIndicatorConfig().hourTable.map((h) => [`${h.roleKey}|${h.task}`, h.id]));
  const used = new Set<string>(cfg.hourTable.map((r) => (r as { id?: unknown })?.id).filter((x): x is string => typeof x === "string" && x.length > 0));
  const rows = cfg.hourTable.map((r) => {
    const row = r as { id?: unknown; roleKey?: unknown; task?: unknown };
    if (!row || typeof row !== "object" || (typeof row.id === "string" && row.id.length > 0)) return r;
    const k = `${String(row.roleKey)}|${String(row.task)}`;
    let id = defaults.get(k) ?? `legacy-${fnv1a(k)}`;
    for (let n = 2; used.has(id); n++) id = `${defaults.get(k) ?? `legacy-${fnv1a(k)}`}-${n}`;
    used.add(id);
    return { ...(r as object), id };
  });
  return { ...(rawConfig as object), hourTable: rows } as T;
}

export function defaultIndicatorConfig(): IndicatorConfig {
  return {
    thresholds: {
      spi: { greenMin: 0.95, yellowMin: 0.85 },
      readiness: { greenMin: 0, yellowMin: -15 },
      load: { roomyMax: 70, greenMax: 90, yellowMax: 110 },
      operational: { openMin: 5, overdueMin: 1 },
      projection: { greenMin: 1.0, yellowMin: 0.8, windowDays: 14, defaultCloseDaysBeforeH: 3, triggerDaysBeforeH: 4 },
      parallelDensityMax: 1.0,
      imbalanceMax: 1.5,
      overdueEscalationDays: 3,
    },
    capacity: { hoursPerDay: 6, workDays: [1, 2, 3, 4, 5], useHrisLeave: true, skipHolidays: false, weeksAhead: 3 },
    weights: {
      REGULAR: { PARTICIPANTS: 30, INSTRUCTOR: 15, MATERIAL: 15, LOGISTICS: 15, ADMIN: 10, CERTIFICATION: 15 },
      PARTNER: { PARTICIPANTS: 15, INSTRUCTOR: 15, MATERIAL: 20, LOGISTICS: 15, ADMIN: 20, CERTIFICATION: 15 },
    },
    participants: { rampStartCode: "R01", rampEndCode: "R09", partnerDeadlineCode: "K10" },
    templates: {
      REGULAR: {
        milestones: [
          ms("R01", "Program masuk Jadwal Induk; halaman program terbit", "H", -60, false, R.TC, 5, true, "ADK/004, ADK/009"),
          ms("R02", "Rencana Kampanye terbit", "H", -60, false, R.MM, 5, false, "MDK/008"),
          ms("R03", "Knowledge Base Halo AI aktif", "H", -30, false, R.MM, 5, false, "MDK/004"),
          ms("R07", "Silabus, RPP, dan bahan ajar final", "H", -17, false, R.SC, 8, true, "ADK/001"),
          ms("R04", "Instruktur terkonfirmasi", "H", -7, false, R.SC, 8, true, "ADK/002"),
          ms("R06", "Jadwal uji dari LSP terkonfirmasi (skema BNSP)", "H", -7, false, R.SC, 8, true, "ADK/002", { bnspOnly: true }),
          ms("R05", "Pemeriksaan jumlah pendaftar", "H", -4, false, R.MM, 5, false, "MDK/008"),
          ms("R09", "Peserta minimum tercapai", "H", -4, false, R.MM, 6, false, "MDK/008"),
          ms("R08", "Keputusan Go/No-Go", "H", -3, false, R.MO, 8, true, "MDK/008"),
          ms("R10", "Validasi peserta lunas; undangan dan tautan terkirim", "H", -1, false, R.TU, 6, false, "ADK/002"),
          ms("R11", "Checklist Kesiapan Kelas lengkap", "H", -1, false, R.TU, 8, true, "ADK/002 Lamp. Moda 4"),
          ms("R12", "Rekap kehadiran dan evaluasi diserahkan", "H_END", 0, false, R.FA, 8, false, "ADK/002"),
          ms("R13", "Arsip absensi, nilai, survei, dokumentasi", "H_END", 1, false, R.FA, 4, false, "ADK/002"),
          ms("R15", "Honorarium instruktur diproses", "H_END", 3, false, R.TK, 4, false, "ADK/002"),
          ms("R14", "Sertifikat terbit", "H_END", 7, false, R.SC, 8, false, "ADK/008"),
          ms("R16", "Tinjauan program", "H_END", 7, false, R.MM, 4, false, "MDK/008"),
        ],
        items: [
          it("INSTRUCTOR", "Instruktur terkonfirmasi", "H", -7, R.SC, true), it("INSTRUCTOR", "Briefing akhir instruktur", "H", -2, R.SC), it("INSTRUCTOR", "Kontrak/honor instruktur disepakati", "H", -7, R.SC),
          it("MATERIAL", "Silabus dan RPP final", "H", -17, R.SC, true), it("MATERIAL", "Bahan ajar final", "H", -10, R.TC), it("MATERIAL", "Alat evaluasi pre/post-test siap", "H", -7, R.TC), it("MATERIAL", "Bahan ajar dicetak/digandakan", "H", -2, R.TU),
          it("LOGISTICS", "Venue atau tautan kelas siap", "H", -7, R.TU, true), it("LOGISTICS", "Konsumsi dipesan", "H", -2, R.TU), it("LOGISTICS", "Perangkat diuji", "H", -2, R.TU), it("LOGISTICS", "Undangan terkirim", "H", -1, R.TU),
          it("ADMIN", "Daftar peserta tervalidasi", "H", -1, R.TU),
          it("CERTIFICATION", "Jadwal uji dari LSP terkonfirmasi", "H", -7, R.SC, true, { bnspOnly: true }), it("CERTIFICATION", "Berkas asesi lengkap", "H", -5, R.TU, false, { bnspOnly: true }), it("CERTIFICATION", "TUK siap", "H", -1, R.TU, false, { bnspOnly: true }),
        ],
      },
      PARTNER: {
        milestones: [
          ms("K01", "Percakapan penemuan kebutuhan", "T", 2, true, R.MM, 4, false, "MDK/007"),
          ms("K02", "Proposal terkirim", "MILESTONE", 1, true, R.A1, 4, false, "MDK/007", { ref: "K01" }),
          ms("K03", "MoU/SPK ditandatangani", "H", -14, false, R.MM, 10, true, "MDK/007"),
          ms("K04", "Serah terima ke Adm. & Kurikulum (Form Serah Terima)", "MILESTONE", 2, true, R.MM, 6, true, "MDK/007", { ref: "K03" }),
          ms("K06", "Rapat pembuka dengan klien", "H", -14, false, R.MM, 4, false, "MDK/007"),
          ms("K05", "Invoice DP terbit", "MANUAL", 0, false, R.TK, 4, false, "ADK/006"),
          ms("K07", "Instruktur terkonfirmasi", "H", -7, false, R.SC, 8, true, "ADK/002"),
          ms("K08", "Jadwal uji dari LSP terkonfirmasi (skema BNSP)", "H", -7, false, R.SC, 6, true, "MDK/007", { bnspOnly: true }),
          ms("K09", "Materi disesuaikan kebutuhan klien, final", "H", -5, false, R.SC, 8, true, "MDK/007"),
          ms("K10", "Daftar peserta dari klien diterima; data asesi ke LSP", "H", -5, false, R.A1, 6, true, "MDK/007"),
          ms("K11", "Checklist Kesiapan Kelas lengkap", "H", -1, false, R.TU, 8, true, "ADK/002 Lamp. Moda 4"),
          ms("K12", "Rekap kehadiran dan evaluasi diserahkan", "H_END", 0, false, R.FA, 6, false, "ADK/002"),
          ms("K15", "Honorarium instruktur diproses", "H_END", 7, false, R.TK, 2, false, "ADK/002"),
          ms("K13", "Laporan kegiatan diterima klien", "H_END", 7, false, R.SC, 8, false, "ADK/003"),
          ms("K14", "Sertifikat terbit", "H_END", 7, false, R.SC, 4, false, "ADK/008"),
          ms("K16", "Tinjauan klien", "H_END", 14, false, R.MM, 4, false, "MDK/007"),
          ms("K17", "Tagihan pelunasan ditagih", "MANUAL", 0, false, R.MM, 4, false, "ADK/006"),
          ms("K18", "Penawaran program lanjutan", "H_END", 30, false, R.MM, 4, false, "MDK/007"),
        ],
        items: [
          it("INSTRUCTOR", "Instruktur terkonfirmasi", "H", -7, R.SC, true), it("INSTRUCTOR", "Briefing akhir instruktur", "H", -2, R.SC), it("INSTRUCTOR", "Kontrak/honor instruktur disepakati", "H", -7, R.SC),
          it("MATERIAL", "Silabus dan RPP final", "H", -14, R.SC, true), it("MATERIAL", "Bahan ajar final", "H", -10, R.TC), it("MATERIAL", "Alat evaluasi pre/post-test siap", "H", -7, R.TC), it("MATERIAL", "Penyesuaian kebutuhan klien, final", "H", -5, R.SC, true),
          it("LOGISTICS", "Venue atau tautan kelas siap", "H", -7, R.TU, true), it("LOGISTICS", "Konsumsi dipesan", "H", -2, R.TU), it("LOGISTICS", "Perangkat diuji", "H", -2, R.TU), it("LOGISTICS", "Undangan terkirim", "H", -1, R.TU),
          it("ADMIN", "MoU/SPK ditandatangani", "H", -14, R.MM, true), it("ADMIN", "Form Serah Terima", "H", -12, R.MM), it("ADMIN", "Rapat pembuka dengan klien", "H", -14, R.MM), it("ADMIN", "Invoice DP terbit", "MANUAL", 0, R.TK),
          it("CERTIFICATION", "Jadwal uji dari LSP terkonfirmasi", "H", -7, R.SC, true, { bnspOnly: true }), it("CERTIFICATION", "Berkas asesi lengkap", "H", -5, R.TU, false, { bnspOnly: true }), it("CERTIFICATION", "TUK siap", "H", -1, R.TU, false, { bnspOnly: true }),
        ],
      },
    },
    hourTable: [
      hr("kampanye-reguler", "MANAGER_MARKETING", "Kampanye program reguler", ["REGULAR"], 3, 0, 0, 0, { anchor: "H", days: -60 }, { anchor: "H", days: -10 }),
      hr("negosiasi-kerjasama", "MANAGER_MARKETING", "Negosiasi dan kontrak program kerjasama", ["PARTNER"], 0, 6, 0, 0, { anchor: "H", days: -60 }, { anchor: "H", days: -10 }),
      hr("materi-promosi", "STAFF_SOCIAL", "Materi promosi dan iklan", ["REGULAR"], 8, 0, 0, 0, { anchor: "H", days: -60 }, { anchor: "H", days: -7 }),
      hr("admisi-b2c", "STAFF_ADMISI_2", "Tanya-jawab, follow-up, pendaftaran", ["REGULAR"], 2, 0, 0.5, 0, { anchor: "H", days: -45 }, { anchor: "H", days: -3 }),
      hr("proposal-b2b", "STAFF_ADMISI_1", "Proposal, koordinasi klien, daftar peserta", ["PARTNER"], 0, 8, 0.1, 0, { anchor: "T", days: 0 }, { anchor: "H", days: -1 }),
      hr("spv-kurikulum", "SPV_CURRICULUM", "Instruktur, pemeriksaan, laporan, sertifikat", ["REGULAR", "PARTNER"], 6, 6, 0.1, 1, { anchor: "H", days: -30 }, { anchor: "H_END", days: 7 }),
      hr("staf-kurikulum", "STAFF_CURRICULUM", "Materi, halaman program; Fasilitator Kelas", ["REGULAR", "PARTNER"], 6, 6, 0, 9, { anchor: "H", days: -30 }, { anchor: "H_END", days: 1 }),
      hr("admin-umum", "STAFF_GENERAL", "Registrasi, logistik, berkas, verifikasi pembayaran", ["REGULAR", "PARTNER"], 4, 4, 0.3, 2, { anchor: "H", days: -14 }, { anchor: "H_END", days: 1 }),
      hr("keuangan", "STAFF_FINANCE", "Invoice, kwitansi, honorarium", ["REGULAR", "PARTNER"], 2, 2, 0.2, 0, { anchor: "H", days: -30 }, { anchor: "H_END", days: 14 }),
      hr("platform-daring", "SPV_IT", "Platform daring dan hybrid", ["REGULAR", "PARTNER"], 0, 0, 0, 2, { anchor: "H", days: -3 }, { anchor: "H", days: 0 }, ["ONLINE", "HYBRID"]),
    ],
    roles: [
      { key: "MANAGER_MARKETING", label: "Manajer Pemasaran dan Kerjasama" }, { key: "MANAGER_OPS", label: "Manajer Operasional dan Keuangan" },
      { key: "SPV_CURRICULUM", label: "Supervisor Adm. & Kurikulum" }, { key: "STAFF_CURRICULUM", label: "Staf Adm. & Kurikulum" },
      { key: "STAFF_GENERAL", label: "Staf Administrasi Umum" }, { key: "STAFF_FINANCE", label: "Staf Administrasi Keuangan" },
      { key: "STAFF_SOCIAL", label: "Staf Social Media Specialist" }, { key: "STAFF_ADMISI_1", label: "Staf Admisi 1 (Asisten B2B)" },
      { key: "STAFF_ADMISI_2", label: "Staf Admisi 2 (B2C)" }, { key: "SPV_IT", label: "Supervisor IT & Web Development" },
      { key: "FACILITATOR", label: "Fasilitator Kelas" },
    ],
    roleHolders: {},
    facilitators: [],
    requireEvidence: true,
    autoApplyOnCreate: true,
    escalation: defaultEscalation(),
  };
}

// ───────────────────────────── Validasi semantik (di luar bentuk data) ─────────────────────────────

export interface ConfigCheck { errors: string[]; warnings: string[] }

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Aturan yang tidak dapat diungkapkan skema: urutan ambang, rujukan kode/jabatan, kesatuan kode. `errors` memblokir simpan; `warnings` tidak. */
export function checkIndicatorConfig(c: IndicatorConfig): ConfigCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const t = c.thresholds;
  if (!(t.spi.greenMin > t.spi.yellowMin)) errors.push("Ketepatan Waktu: batas Hijau (SPI) harus lebih besar dari batas Kuning.");
  if (!(t.readiness.greenMin > t.readiness.yellowMin)) errors.push("Kesiapan: batas Hijau (selisih IKP) harus lebih besar dari batas Kuning.");
  if (!(t.load.roomyMax < t.load.greenMax && t.load.greenMax < t.load.yellowMax)) errors.push("Beban: urutan batas harus ada ruang < Hijau < Kuning (mis. 70 < 90 < 110).");
  if (!(t.projection.greenMin > t.projection.yellowMin)) errors.push("Proyeksi peserta: batas Hijau harus lebih besar dari batas Kuning.");
  const roleKeys = new Set(c.roles.map((r) => r.key));
  if (roleKeys.size !== c.roles.length) errors.push("Kunci jabatan tidak boleh kembar.");
  for (const k of Object.keys(c.roleHolders)) if (!roleKeys.has(k)) errors.push(`Pemegang jabatan merujuk jabatan yang tidak ada: ${k}.`);

  for (const track of TRACKS) {
    const tpl = c.templates[track];
    const label = TRACK_LABEL[track];
    const codes = tpl.milestones.map((m) => m.code);
    if (new Set(codes).size !== codes.length) errors.push(`${label}: kode milestone tidak boleh kembar.`);
    const codeSet = new Set(codes);
    for (const m of tpl.milestones) {
      if (m.anchor === "MILESTONE" && (!m.ref || !codeSet.has(m.ref) || m.ref === m.code)) errors.push(`${label}: milestone ${m.code} merujuk milestone yang tidak sah (${m.ref ?? "kosong"}).`);
      if (m.roleKey && !roleKeys.has(m.roleKey)) errors.push(`${label}: milestone ${m.code} memakai jabatan yang tidak ada (${m.roleKey}).`);
    }
    for (const i of tpl.items) {
      if (i.anchor === "MILESTONE" && (!i.ref || !codeSet.has(i.ref))) errors.push(`${label}: item "${i.name}" merujuk milestone yang tidak ada (${i.ref ?? "kosong"}).`);
      if (i.roleKey && !roleKeys.has(i.roleKey)) errors.push(`${label}: item "${i.name}" memakai jabatan yang tidak ada (${i.roleKey}).`);
    }
    if (tpl.milestones.length && sum(tpl.milestones.map((m) => m.weight)) !== 100) warnings.push(`${label}: jumlah bobot milestone = ${sum(tpl.milestones.map((m) => m.weight))} (dokumen: 100). SPI tetap dihitung sebagai rasio.`);
    if (sum(Object.values(c.weights[track])) !== 100) warnings.push(`${label}: jumlah bobot komponen kesiapan = ${sum(Object.values(c.weights[track]))} (dokumen: 100). IKP dinormalkan oleh pembagi Σw.`);
  }
  if (!c.templates.REGULAR.milestones.some((m) => m.code === c.participants.rampStartCode) || !c.templates.REGULAR.milestones.some((m) => m.code === c.participants.rampEndCode)) {
    errors.push("Kode milestone awal/akhir untuk kenaikan komponen Peserta (reguler) harus ada pada template Reguler.");
  }
  if (!c.templates.PARTNER.milestones.some((m) => m.code === c.participants.partnerDeadlineCode)) errors.push("Kode milestone tenggat daftar peserta (kerjasama) harus ada pada template Kerjasama.");
  const e = c.escalation;
  for (const [k, v] of Object.entries(e.reportsTo)) {
    if (!roleKeys.has(k)) errors.push(`Eskalasi: atasan ditetapkan untuk jabatan yang tidak ada (${k}).`);
    if (v !== null && !roleKeys.has(v)) errors.push(`Eskalasi: atasan ${k} merujuk jabatan yang tidak ada (${v}).`);
    if (v === k) errors.push(`Eskalasi: jabatan ${k} tidak boleh menjadi atasannya sendiri.`);
  }
  for (const start of Object.keys(e.reportsTo)) { // rantai atasan tidak boleh melingkar
    const seen = new Set<string>([start]);
    for (let cur = e.reportsTo[start] ?? null; cur; cur = e.reportsTo[cur] ?? null) {
      if (seen.has(cur)) { errors.push(`Eskalasi: rantai atasan melingkar dimulai dari ${start}.`); break; }
      seen.add(cur);
    }
  }
  for (const [label, key] of [["Merah (pelaksanaan)", e.redExecutionRole], ["Merah (pemasaran/klien)", e.redMarketingRole], ["Merah (selalu diberi tahu)", e.redAlwaysRole], ["Beban berlebih", e.overloadRole]] as const) {
    if (!roleKeys.has(key)) errors.push(`Eskalasi ${label}: jabatan tidak ada (${key}).`);
  }
  for (const k of e.marketingRoleKeys) if (!roleKeys.has(k)) errors.push(`Eskalasi: jabatan pemasaran/klien tidak ada (${k}).`);
  for (const h of c.hourTable) if (!roleKeys.has(h.roleKey)) errors.push(`Tabel jam standar memakai jabatan yang tidak ada (${h.roleKey}).`);
  const seenHour = new Set<string>();
  for (const h of c.hourTable) { if (seenHour.has(h.id)) errors.push(`Tabel jam standar: ID baris kembar (${h.id}). Setiap baris harus punya ID sendiri.`); seenHour.add(h.id); }
  return { errors, warnings };
}
