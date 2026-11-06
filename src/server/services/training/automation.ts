import "server-only";
import { prisma, transaction, type Tx } from "../../db";
import { trainingEnabled } from "../../env";
import { dateToIso, isoToDate } from "../../json";
import { notifyUsers } from "../notifications";
import { addDays } from "@/lib/time";
import type { IndicatorConfig } from "@/lib/training/indicators/config";
import { resolveDueMap, resolveOffset } from "@/lib/training/indicators/engine";
import { decideProgramEscalations, type EscalationEvent, type RecipientSpec } from "@/lib/training/indicators/escalation";
import { canUserViewProject } from "./access";
import { computeActivePrograms, loadData, loadSnapshots, runsOf, weekLoadOf, type Env, type ProgramIndicatorDto } from "./indicator-compute";
import { dateCtx, specOf, toProgramRow } from "./indicator-data";

/**
 * Pekerja harian Training & Operations: (1) snapshot status program, (2) eskalasi otomatis sesuai dokumen §5.2, (3) pengingat tenggat H-1 dan hari-H.
 * IDEMPOTEN: dapat dipanggil berulang (tiap jam, banyak instance); tiap pemberitahuan punya kunci unik per penerima di `training_reminder_log`,
 * sehingga tidak ada pesan ganda. Notifikasi lewat mekanisme yang sudah ada (dalam aplikasi selalu; email/WhatsApp hanya bila dikonfigurasi dan dipilih pengguna).
 */

export interface JobResult { skipped: string | null; snapshots: number; reminders: number; escalations: number }

interface Outgoing { dedupeKey: string; kind: string; projectId: string | null; userId: string; type: string; title: string; body: string; href: string }

// ───────────────────────────── Penerima ─────────────────────────────

class Recipients {
  private userCache = new Map<string, string | null>();
  private directorCache: string[] | null = null;
  constructor(private cfg: IndicatorConfig) {}

  /** Akun aktif milik karyawan aktif; null bila karyawan nonaktif atau belum punya akun. */
  async userOf(employeeId: string | null | undefined): Promise<string | null> {
    if (!employeeId) return null;
    if (this.userCache.has(employeeId)) return this.userCache.get(employeeId)!;
    const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { isActive: true, userId: true } });
    let id: string | null = null;
    if (e?.isActive && e.userId) id = (await prisma.user.findFirst({ where: { id: e.userId, isActive: true }, select: { id: true } }))?.id ?? null;
    this.userCache.set(employeeId, id);
    return id;
  }
  private viewCache = new Map<string, boolean>();
  /**
   * Penerima pengingat HARUS masih boleh membuka proyeknya (level modul / Super Admin, atau keanggotaan proyek yang masih aktif): kode proyek
   * dan judul tugas tidak boleh dikirim ke orang yang sudah dikeluarkan dari proyek. Akun yang tidak terjangkau → false.
   */
  async mayView(projectId: string, employeeId: string | null | undefined): Promise<boolean> {
    if (!employeeId) return false;
    const key = `${projectId}:${employeeId}`;
    const hit = this.viewCache.get(key);
    if (hit !== undefined) return hit;
    const userId = await this.userOf(employeeId);
    const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }) : null;
    const ok = !!userId && !!user && (await canUserViewProject(prisma, { userId, role: user.role, employeeId }, projectId));
    this.viewCache.set(key, ok);
    return ok;
  }
  async directors(): Promise<string[]> {
    return (this.directorCache ??= (await prisma.user.findMany({ where: { isActive: true, role: "SUPER_ADMIN" }, select: { id: true } })).map((u) => u.id));
  }
  holderOf(roleKey: string): string | null { return this.cfg.roleHolders[roleKey] ?? null; }
  /** Atasan langsung (pemegang jabatan atasan) dari seorang karyawan, menurut `escalation.reportsTo` & jabatan yang ia pegang. */
  supervisorsOf(employeeId: string, onlyRole?: string | null): string[] {
    const out = new Set<string>();
    for (const [role, holder] of Object.entries(this.cfg.roleHolders)) {
      if (holder !== employeeId || (onlyRole && role !== onlyRole)) continue;
      const up = this.cfg.escalation.reportsTo[role];
      const boss = up ? this.holderOf(up) : null;
      if (boss && boss !== employeeId) out.add(boss);
    }
    return [...out];
  }
  async pic(projectId: string): Promise<string | null> {
    const m = await prisma.trainingProjectMember.findFirst({ where: { projectId, role: "PROJECT_MANAGER", endedAt: null }, select: { employeeId: true } });
    return m?.employeeId ?? null;
  }
  /** Terjemahkan spesifikasi → akun pengguna. Tanpa penerima yang dapat dijangkau → Direktur (Super Admin), agar pesan penting tidak hilang diam-diam. */
  async resolve(specs: RecipientSpec[], projectId: string): Promise<string[]> {
    const users = new Set<string>();
    for (const sp of specs) {
      const found: string[] = [];
      const push = async (emp: string | null | undefined) => { const u = await this.userOf(emp); if (u) found.push(u); };
      if (sp.type === "PIC") await push(await this.pic(projectId));
      else if (sp.type === "ROLE") await push(this.holderOf(sp.roleKey));
      else if (sp.type === "SUPERVISOR_OF_PIC") { const pic = await this.pic(projectId); if (pic) for (const b of this.supervisorsOf(pic)) await push(b); }
      else if (sp.employeeId) for (const b of this.supervisorsOf(sp.employeeId, sp.roleKey)) await push(b);
      if (found.length === 0) found.push(...(await this.directors()));
      for (const u of found) users.add(u);
    }
    return [...users];
  }
}

// ───────────────────────────── Pengiriman (dedupe + outbox) ─────────────────────────────

async function dispatch(items: Outgoing[]): Promise<number> {
  const unique = [...new Map(items.map((i) => [i.dedupeKey, i])).values()];
  if (unique.length === 0) return 0;
  return transaction(async (tx: Tx) => {
    const created = await tx.trainingReminderLog.createManyAndReturn({ data: unique.map((i) => ({ dedupeKey: i.dedupeKey, kind: i.kind, projectId: i.projectId })), skipDuplicates: true, select: { dedupeKey: true } });
    const fresh = new Set(created.map((c) => c.dedupeKey));
    const send = unique.filter((i) => fresh.has(i.dedupeKey));
    const groups = new Map<string, { n: Outgoing; users: string[] }>();
    for (const i of send) {
      const k = `${i.type}|${i.title}|${i.body}|${i.href}`;
      const g = groups.get(k) ?? { n: i, users: [] };
      g.users.push(i.userId);
      groups.set(k, g);
    }
    for (const g of groups.values()) await notifyUsers(tx, g.users, { type: g.n.type, title: g.n.title, body: g.n.body, href: g.n.href });
    return send.length;
  });
}

// ───────────────────────────── Eskalasi & snapshot ─────────────────────────────

async function snapshotAndEscalate(env: Env, cfg: IndicatorConfig, cards: ProgramIndicatorDto[], rec: Recipients): Promise<{ snapshots: number; out: Outgoing[] }> {
  const t = env.today;
  const prior = await loadSnapshots(prisma, cards.map((c) => c.projectId), t);
  const milestones = await prisma.trainingMilestone.findMany({ where: { projectId: { in: cards.map((c) => c.projectId) } }, select: { id: true, projectId: true, code: true, name: true, roleKey: true, assigneeId: true } });
  const byProject = new Map<string, typeof milestones>();
  for (const m of milestones) byProject.set(m.projectId, [...(byProject.get(m.projectId) ?? []), m]);

  const out: Outgoing[] = [];
  let snapshots = 0;
  for (const c of cards) {
    if (!c.applied || !c.overall) continue;
    await prisma.trainingStatusSnapshot.upsert({
      where: { projectId_date: { projectId: c.projectId, date: isoToDate(t) } },
      create: { projectId: c.projectId, date: isoToDate(t), overall: c.overall, timeliness: c.timeliness?.status ?? null, readiness: c.readiness?.status ?? null, load: c.load.status, triggers: c.triggers },
      update: { overall: c.overall, timeliness: c.timeliness?.status ?? null, readiness: c.readiness?.status ?? null, load: c.load.status, triggers: c.triggers },
    });
    snapshots++;

    const ms = byProject.get(c.projectId) ?? [];
    const byCode = new Map(ms.map((m) => [m.code, m]));
    const runs = runsOf(prior.get(c.projectId) ?? [], t, c.overall, env.cal);
    const marketing = new Set(cfg.escalation.marketingRoleKeys);
    const marketingCause = c.triggers.includes("PROJECTION_LOW") || (c.timeliness?.criticalOverdue ?? []).some((code) => { const k = byCode.get(code)?.roleKey; return !!k && marketing.has(k); });
    const events: EscalationEvent[] = decideProgramEscalations({
      projectId: c.projectId, code: c.code, name: c.name, track: c.track, startDate: c.startDate, today: t, overall: c.overall, triggers: c.triggers, yellow: runs.yellow, red: runs.red, marketingCause,
      overdue: (c.timeliness?.escalateDetail ?? []).flatMap((d) => { const m = byCode.get(d.code); return m ? [{ id: m.id, code: m.code, name: m.name, daysOverdue: d.daysOverdue, assigneeId: m.assigneeId, roleKey: m.roleKey }] : []; }),
    }, cfg.escalation);
    for (const ev of events) {
      for (const userId of await rec.resolve(ev.recipients, c.projectId)) {
        out.push({ dedupeKey: `esc:${ev.key}:${userId}`, kind: `escalation.${ev.kind}`, projectId: c.projectId, userId, type: `training.escalation.${ev.kind.toLowerCase()}`, title: ev.title, body: ev.body, href: `/training/proyek/${c.projectId}?tab=pemantauan${ev.recovery ? "#pemulihan" : ""}` });
      }
    }
  }
  return { snapshots, out };
}

/** Beban staf di atas batas Overload pada dua minggu berturut-turut → Manajer Operasional dan Keuangan (rapat Senin berikutnya). */
async function overloadEscalations(env: Env, cfg: IndicatorConfig, rec: Recipients): Promise<Outgoing[]> {
  if (!cfg.escalation.enabled) return [];
  const out: Outgoing[] = [];
  for (const emp of env.taskHolders) {
    const bands = env.weeks.map((w) => weekLoadOf(env, emp, w));
    const streak = bands.some((b, i) => b.band === "OVERLOAD" && bands[i + 1]?.band === "OVERLOAD");
    if (!streak) continue;
    const name = env.person(emp)?.name ?? "Staf";
    const peak = Math.max(...bands.map((b) => b.pct));
    for (const userId of await rec.resolve([{ type: "ROLE", roleKey: cfg.escalation.overloadRole }], "")) {
      if (userId === (await rec.userOf(emp))) continue;
      out.push({
        dedupeKey: `esc:overload:${emp}:${env.weeks[0]}:${userId}`, kind: "escalation.OVERLOAD", projectId: null, userId, type: "training.escalation.overload",
        title: `Beban ${name} Overload dua minggu berturut-turut`, body: `Puncak ${peak >= 9999 ? ">999" : Math.round(peak)}% dari kapasitas (batas ${cfg.thresholds.load.yellowMax}%). Bagi ulang tugas atau tahan program baru; hubungi Direktur bila perlu personel tambahan.`,
        href: "/training/pemantauan?tab=tim",
      });
    }
  }
  return out;
}

// ───────────────────────────── Pengingat tenggat ─────────────────────────────

const OPEN_TASK = ["TODO", "IN_PROGRESS"] as const;

async function reminders(env: Env, cfg: IndicatorConfig, rec: Recipients): Promise<Outgoing[]> {
  const r = cfg.escalation.reminders;
  const t = env.today;
  const tomorrow = addDays(t, 1);
  const days: { iso: string; when: "H-1" | "H" }[] = [...(r.dayBefore ? [{ iso: tomorrow, when: "H-1" as const }] : []), ...(r.dayOf ? [{ iso: t, when: "H" as const }] : [])];
  if (days.length === 0 && !r.programStart) return [];
  const out: Outgoing[] = [];
  const msg = (when: "H-1" | "H", what: string) => ({ type: when === "H" ? "training.reminder.due_today" : "training.reminder.due_tomorrow", title: `${what} jatuh tempo ${when === "H" ? "hari ini" : "besok"}` });
  const live = { status: { in: ["PREPARATION", "RUNNING"] as ("PREPARATION" | "RUNNING")[] } };

  if (days.length) {
    // Tugas: penanggung jawab. Hanya yang masih dikerjakan (Belum/Proses); "Menunggu pemeriksaan" ada di tangan pemeriksa.
    const tasks = await prisma.trainingTask.findMany({
      where: { status: { in: [...OPEN_TASK] }, assigneeId: { not: null }, dueDate: { in: days.map((d) => isoToDate(d.iso)) }, project: { status: { notIn: ["COMPLETED", "CANCELLED"] } } },
      select: { id: true, title: true, dueDate: true, assigneeId: true, project: { select: { id: true, code: true } } },
    });
    for (const x of tasks) {
      const userId = await rec.userOf(x.assigneeId);
      const due = dateToIso(x.dueDate!);
      const when = due === t ? "H" : "H-1";
      if (!userId) continue;
      if (await rec.mayView(x.project.id, x.assigneeId)) {
        out.push({ dedupeKey: `rem:task:${x.id}:${due}:${when}:${userId}`, kind: "reminder.task", projectId: x.project.id, userId, ...msg(when, "Tugas"), body: `${x.project.code} · ${x.title}`, href: "/training/tugas-saya" });
        continue;
      }
      // Penanggung jawab sudah tidak boleh membuka proyek ini (keanggotaan berakhir): tidak dikirimi apa pun; PIC yang menindaklanjuti tugas yatim itu.
      const pic = await rec.userOf(await rec.pic(x.project.id));
      if (pic) out.push({ dedupeKey: `rem:task:${x.id}:${due}:${when}:${pic}`, kind: "reminder.task", projectId: x.project.id, userId: pic, ...msg(when, "Tugas tanpa penanggung jawab aktif"), body: `${x.project.code} · ${x.title}`, href: `/training/proyek/${x.project.id}?tab=tugas` });
    }

    // Milestone & item kesiapan: tenggat dihitung dari tanggal H/T + offset (tidak disimpan).
    const projects = await prisma.trainingProject.findMany({ where: { ...live, indicatorsAppliedAt: { not: null } } });
    const data = await loadData(prisma, projects.map((p) => p.id));
    for (const p of projects) {
      const row = toProgramRow(p);
      const d = data.get(p.id)!;
      const dues = resolveDueMap(d.milestones.map((m) => ({ code: m.code, spec: specOf(m) })), dateCtx(row), env.cal);
      // Penanggung jawab hanya diingatkan bila masih boleh membuka proyek; selain itu (tak terjangkau / sudah tak punya akses) ke PIC.
      const picUser = async (assignee: string | null) => ((await rec.mayView(p.id, assignee)) ? await rec.userOf(assignee) : null) ?? (await rec.userOf(await rec.pic(p.id)));
      for (const m of d.milestones) {
        const due = dues.get(m.code) ?? null;
        if (!due || m.doneAt || m.notApplicable || (m.bnspOnly && !p.bnsp)) continue;
        const hit = days.find((x) => x.iso === due);
        const userId = hit && (await picUser(m.assigneeId));
        if (hit && userId) out.push({ dedupeKey: `rem:ms:${m.id}:${due}:${hit.when}:${userId}`, kind: "reminder.milestone", projectId: p.id, userId, ...msg(hit.when, "Milestone"), body: `${p.code} · ${m.code} ${m.name}`, href: `/training/proyek/${p.id}?tab=pemantauan` });
      }
      for (const i of d.items) {
        if (i.status !== "OPEN" || (i.bnspOnly && !p.bnsp)) continue;
        const due = resolveOffset(specOf(i), dateCtx(row), (c) => dues.get(c) ?? null, env.cal);
        const hit = due ? days.find((x) => x.iso === due) : undefined;
        const userId = hit && (await picUser(i.assigneeId));
        if (hit && due && userId) out.push({ dedupeKey: `rem:item:${i.id}:${due}:${hit.when}:${userId}`, kind: "reminder.item", projectId: p.id, userId, ...msg(hit.when, "Item kesiapan"), body: `${p.code} · ${i.name}`, href: `/training/proyek/${p.id}?tab=pemantauan` });
      }
    }
  }

  if (r.programStart) {
    const starting = await prisma.trainingProject.findMany({
      where: { ...live, startDate: { in: [isoToDate(t), isoToDate(tomorrow)] } },
      select: { id: true, code: true, name: true, startDate: true, members: { where: { endedAt: null }, select: { employeeId: true } } },
    });
    for (const p of starting) {
      const start = dateToIso(p.startDate!);
      const when = start === t ? "H" : "H-1";
      for (const m of p.members) {
        const userId = await rec.userOf(m.employeeId);
        if (userId) out.push({ dedupeKey: `rem:start:${p.id}:${start}:${when}:${userId}`, kind: "reminder.start", projectId: p.id, userId, type: when === "H" ? "training.reminder.start_today" : "training.reminder.start_tomorrow", title: when === "H" ? "Pelaksanaan dimulai hari ini" : "Pelaksanaan dimulai besok", body: `${p.code} · ${p.name}`, href: `/training/proyek/${p.id}` });
      }
    }
  }
  return out;
}

// ───────────────────────────── Titik masuk ─────────────────────────────

export async function runTrainingDailyJob(): Promise<JobResult> {
  if (!trainingEnabled()) return { skipped: "Modul Training & Operations tidak aktif.", snapshots: 0, reminders: 0, escalations: 0 };
  const { env, loaded, cards } = await computeActivePrograms();
  const cfg = loaded.config;
  const rec = new Recipients(cfg);
  const { snapshots, out: esc } = await snapshotAndEscalate(env, cfg, cards, rec);
  const overload = await overloadEscalations(env, cfg, rec);
  const rem = await reminders(env, cfg, rec);
  const escalations = await dispatch(cfg.escalation.enabled ? [...esc, ...overload] : []);
  const sent = await dispatch(rem);
  return { skipped: null, snapshots, reminders: sent, escalations };
}
