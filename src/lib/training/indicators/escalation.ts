/**
 * Aturan eskalasi (dokumen §5.2) — MURNI: memutuskan peristiwa apa yang harus diberitahukan dan kepada JABATAN/peran apa.
 * Pemilihan orang (pemegang jabatan → akun) dan pengiriman dilakukan service; di sini hanya keputusan, agar dapat diuji tanpa database.
 */
import { isWorkday, TRIGGER_LABEL, type Color, type TriggerCode, type WorkCal } from "./engine";
import type { Escalation, Track } from "./config";
import { addDays, diffDays } from "@/lib/time";

export interface SnapshotIn { date: string; overall: Color }
export interface StatusRun { count: number; startDate: string | null }

/**
 * Deret HARI KERJA berturut-turut berstatus `color` yang berakhir pada hari kerja terakhir ≤ `today`.
 * Akhir pekan dilewati (tidak memutus, tidak dihitung). Hari kerja tanpa snapshot memutus deret: tanpa data, tidak ada klaim "berturut-turut".
 */
export function statusRun(snaps: SnapshotIn[], today: string, color: Color, cal: WorkCal): StatusRun {
  const by = new Map(snaps.map((s) => [s.date, s.overall]));
  let d = today;
  for (let i = 0; i < 14 && !isWorkday(d, cal); i++) d = addDays(d, -1);
  let count = 0;
  let startDate: string | null = null;
  for (let i = 0; i < 90; i++) {
    if (isWorkday(d, cal)) {
      if (by.get(d) !== color) break;
      count++; startDate = d;
    }
    d = addDays(d, -1);
  }
  return { count, startDate };
}

/** Penerima ditulis sebagai spesifikasi; service yang menerjemahkannya menjadi akun pengguna aktif. */
export type RecipientSpec =
  | { type: "PIC" }
  | { type: "SUPERVISOR_OF_PIC" }
  /** `roleKey`: jabatan yang dipegang saat memegang pekerjaan itu — atasan dihitung dari jabatan tsb (orang yang merangkap jabatan tidak boleh memakai atasan jabatan lain). */
  | { type: "SUPERVISOR_OF_EMPLOYEE"; employeeId: string | null; roleKey?: string | null }
  | { type: "ROLE"; roleKey: string };

export type EscalationKind = "YELLOW" | "YELLOW_STREAK" | "RED" | "RED_LATE" | "OVERDUE";
export interface EscalationEvent {
  /** Kunci dedupe tanpa penerima (service menambahkan penerima). Sama = tidak dikirim ulang. */
  key: string; kind: EscalationKind; recipients: RecipientSpec[]; title: string; body: string;
  /** Peristiwa ini mewajibkan catatan/rencana pemulihan di portal. */
  recovery: boolean;
}

export interface OverdueMilestone { id: string; code: string; name: string; daysOverdue: number; assigneeId: string | null; roleKey?: string | null }
export interface ProgramState {
  projectId: string; code: string; name: string; track: Track; startDate: string | null; today: string;
  overall: Color | null; triggers: TriggerCode[];
  yellow: StatusRun; red: StatusRun;
  /** Milestone lewat tenggat lebih dari ambang eskalasi. */
  overdue: OverdueMilestone[];
  /** Penyebab Merah berasal dari urusan pemasaran/klien (mis. proyeksi peserta, milestone kritikal milik jabatan pemasaran). */
  marketingCause: boolean;
}

export function decideProgramEscalations(p: ProgramState, cfg: Escalation): EscalationEvent[] {
  if (!cfg.enabled || p.overall === null) return [];
  const out: EscalationEvent[] = [];
  const label = `${p.code} · ${p.name}`;

  if (p.overall === "YELLOW" && p.yellow.startDate) {
    out.push({
      key: `yellow:${p.projectId}:${p.yellow.startDate}`, kind: "YELLOW", recipients: [{ type: "PIC" }], recovery: false,
      title: `Program ${p.code} berstatus Kuning`, body: `${label}: selesaikan milestone yang tertinggal; tenggat berikutnya menentukan apakah status naik atau turun.`,
    });
    if (p.yellow.count >= cfg.yellowStreakDays) {
      out.push({
        key: `yellow-streak:${p.projectId}:${p.yellow.startDate}`, kind: "YELLOW_STREAK", recipients: [{ type: "SUPERVISOR_OF_PIC" }, { type: "PIC" }], recovery: true,
        title: `Program ${p.code} Kuning ${p.yellow.count} hari kerja berturut-turut`,
        body: `${label}: tulis rencana pemulihan di portal dalam 1 hari kerja (tab Pemantauan → Catatan pemulihan).`,
      });
    }
  }

  if (p.overall === "RED" && p.red.startDate) {
    const causes = p.triggers.length ? p.triggers.map((t) => TRIGGER_LABEL[t]).join("; ") : "skor indikator berada di zona Merah";
    out.push({
      key: `red:${p.projectId}:${p.red.startDate}`, kind: "RED", recovery: true,
      recipients: [{ type: "ROLE", roleKey: p.marketingCause ? cfg.redMarketingRole : cfg.redExecutionRole }, { type: "ROLE", roleKey: cfg.redAlwaysRole }, { type: "PIC" }],
      title: `Program ${p.code} MERAH — putuskan pemulihan hari ini`,
      body: `${label}: ${causes}. Putuskan: tambah orang, geser tugas, atau ubah rencana; catat keputusannya di portal.`,
    });
    const days = p.startDate ? diffDays(p.startDate, p.today) : null;
    if (days !== null && days >= 1 && days <= cfg.redLateWindowDays) {
      out.push({
        key: `red-late:${p.projectId}:${p.red.startDate}`, kind: "RED_LATE", recovery: true,
        recipients: [{ type: "ROLE", roleKey: cfg.redAlwaysRole }, { type: "ROLE", roleKey: cfg.redExecutionRole }, ...(p.track === "PARTNER" ? [{ type: "ROLE", roleKey: cfg.redMarketingRole } as const] : [])],
        title: `Merah pada H-${days}: ${p.code}`,
        body: `${label} dimulai ${p.startDate}. Putuskan Go/No-Go atau jadwalkan ulang hari ini (SOP MDK/008, ADK/002 Tahap V).${p.track === "PARTNER" ? " Kerjasama: klien diberi tahu tertulis oleh Manajer Pemasaran dan Kerjasama." : ""}`,
      });
    }
  }

  for (const m of p.overdue) {
    out.push({
      key: `overdue:${m.id}`, kind: "OVERDUE", recovery: true,
      recipients: [m.assigneeId ? { type: "SUPERVISOR_OF_EMPLOYEE", employeeId: m.assigneeId, roleKey: m.roleKey ?? null } : { type: "SUPERVISOR_OF_PIC" }],
      title: `Milestone ${m.code} terlambat ${m.daysOverdue} hari`,
      body: `${label} · ${m.name}: catat penyebab dan tanggal selesai baru dalam 1 hari kerja.`,
    });
  }
  return out;
}

export const RECOVERY_KINDS = ["YELLOW_STREAK", "RED", "OVERDUE", "OVERLOAD", "OTHER"] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];
export const RECOVERY_KIND_LABEL: Record<RecoveryKind, string> = {
  YELLOW_STREAK: "Kuning berturut-turut", RED: "Merah — keputusan pemulihan", OVERDUE: "Milestone terlambat", OVERLOAD: "Beban berlebih", OTHER: "Lainnya",
};
