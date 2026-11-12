import { DiscussButton } from "@/components/chat/discuss-button";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Tile } from "@/components/ui/stat";
import { AttentionBadges, Breadcrumb, ProjectStatusBadge, TabNav } from "@/components/training/ui";
import { ProjectActions } from "@/components/training/project-actions";
import { ProjectEditButton } from "@/components/training/project-form";
import { TeamPanel } from "@/components/training/team-panel";
import { TasksPanel } from "@/components/training/tasks-panel";
import { ChecklistPanel } from "@/components/training/checklist-panel";
import { SchedulePanel } from "@/components/training/schedule-panel";
import { ParticipantsPanel } from "@/components/training/participants-panel";
import { ProjectInstructorsPanel } from "@/components/training/instructors-panel";
import { DocumentsPanel } from "@/components/training/documents-panel";
import { ReferencesPanel } from "@/components/training/references-panel";
import { ClosurePanel } from "@/components/training/closure-panel";
import { MonitoringPanel } from "@/components/training/monitoring-panel";
import { ColorBadge, MiniIndicators } from "@/components/training/indicator-ui";
import { TRACK_LABEL } from "@/lib/training/indicators/config";
import { getProgramIndicators } from "@/server/services/training/indicator-compute";
import { listRecoveryNotes } from "@/server/services/training/recovery";
import { listMilestones, listReadiness, listWorkloadTasks, listWorkloadTemplateEntries } from "@/server/services/training/indicator-data";
import { actorCan } from "@/server/actor";
import { env } from "@/server/env";
import { getProject, listMembers, listPrograms } from "@/server/services/training/projects";
import { listDirectory } from "@/server/services/training/access";
import { listChecklist, listProjectTasks, listTemplates } from "@/server/services/training/work";
import {
  listAssignmentLinks, listDocuments, listExternalRefs, listInstructors, listProjectInstructors, listProjectParticipants, listProjectSchedules,
} from "@/server/services/training/operations";
import { getClosurePreview, listProjectActivity } from "@/server/services/training/insights";
import { ACTIVITY_KIND_LABEL, DELIVERY_MODE_LABEL, isFinalProject } from "@/lib/training/types";
import { formatDateLong, formatDateRange, formatDateTime } from "@/lib/format";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { guard, trainingPage } from "../../_lib";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> { return { title: "Detail Proyek" }; }

const TABS = ["ringkasan", "pemantauan", "tim", "tugas", "jadwal", "peserta", "instruktur", "dokumen", "riwayat", "penutupan"] as const;
type Tab = (typeof TABS)[number];

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { user, ctx } = await trainingPage();
  const { id } = await params;
  const sp = await flattenSearchParams(searchParams);
  const p = await guard(() => getProject(user, id));
  const can = (a: (typeof p.abilities)[number]) => p.abilities.includes(a);
  // Akun Magang tidak melihat tab Peserta (daftar peserta tertutup bagi mereka).
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") && !(sp.tab === "peserta" && !can("view_participants")) ? (sp.tab as Tab) : "ringkasan";
  const editable = !isFinalProject(p.status);
  const programs = can("update") && editable ? await guard(() => listPrograms(user)) : [];
  const base = `/training/proyek/${id}`;

  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Proyek Pelatihan", href: "/training/proyek" }, { label: p.code }]} />
      <PageHeader
        title={p.name}
        description={`${p.code} · ${ACTIVITY_KIND_LABEL[p.kind]}${p.programName ? ` · ${p.programName}` : ""}${p.clientName ? ` · ${p.clientName}` : ""}`}
        actions={<>
          <ProjectStatusBadge status={p.status} />
          <DiscussButton type="TRAINING_PROJECT" id={id} />
          {can("update") && editable && <ProjectEditButton projectId={id} programs={programs} initial={{ name: p.name, programId: p.programId ?? "", kind: p.kind, clientName: p.clientName ?? "", deliveryMode: p.deliveryMode, location: p.location ?? "", startDate: p.startDate ?? "", endDate: p.endDate ?? "", description: p.description ?? "", notes: p.notes ?? "", track: p.track, bnsp: p.bnsp, participantsMin: p.participantsMin?.toString() ?? "", participantsMax: p.participantsMax?.toString() ?? "", requestDate: p.requestDate ?? "", registrationCloseDate: p.registrationCloseDate ?? "" }} />}
          <ProjectActions id={id} status={p.status} abilities={p.abilities} />
        </>}
      />
      {p.attention.length > 0 && <div className="mb-4"><AttentionBadges codes={p.attention} /></div>}
      {!editable && <div className="mb-4"><Notice tone={p.status === "CANCELLED" ? "danger" : "info"}>{p.status === "COMPLETED" ? "Proyek sudah ditutup (Selesai): data bersifat baca-saja, kecuali tugas tindak lanjut (ditandai pada tab Tugas) yang tetap dapat dikerjakan." : `Proyek dibatalkan${p.cancelReason ? `: ${p.cancelReason}` : ""}. Data bersifat baca-saja.`}</Notice></div>}
      <TabNav base={base} active={tab} tabs={[
        { key: "ringkasan", label: "Ringkasan" }, { key: "pemantauan", label: "Pemantauan" }, { key: "tim", label: "Tim" }, { key: "tugas", label: "Tugas & Checklist", count: p.openTasks }, { key: "jadwal", label: "Jadwal" },
        { key: "peserta", label: "Peserta" }, { key: "instruktur", label: "Instruktur / Asesor" }, { key: "dokumen", label: "Dokumen" }, { key: "riwayat", label: "Riwayat" }, { key: "penutupan", label: "Penutupan" },
      ].filter((t) => t.key !== "peserta" || can("view_participants"))} />

      {tab === "ringkasan" && (async () => {
        const [links, refs] = await Promise.all([guard(() => listAssignmentLinks(user, id)), guard(() => listExternalRefs(user, id))]);
        const hris = actorCan(user, "assignment:view_all");
        const ind = await guard(() => getProgramIndicators(user, id));
        return (
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Progres checklist" value={p.checklist.percent === null ? "Belum tersedia" : `${p.checklist.percent}%`} hint={p.checklist.total ? `${p.checklist.done}/${p.checklist.total} item` : "Belum ada item checklist"} />
              <Tile label="Tugas terbuka" value={p.openTasks} href={`${base}?tab=tugas`} />
              <Tile label="Tugas terlambat" value={p.overdueTasks} tone={p.overdueTasks ? "red" : undefined} />
              <Tile label="Project Manager (PIC)" value={p.picName ?? "Belum ada"} href={`${base}?tab=tim`} tone={p.picName ? undefined : "amber"} />
            </div>
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3"><span className="text-sm font-medium text-ink">Status pemantauan</span><ColorBadge color={ind.overall} /></div>
                <Link href={`${base}?tab=pemantauan`} className="text-sm font-medium text-brand-700 hover:underline">Lihat rincian →</Link>
              </div>
              <div className="mt-3"><MiniIndicators ind={ind} /></div>
            </Card>
            <Card><CardHeader title="Informasi proyek" />
              <dl className="grid gap-x-6 gap-y-4 px-5 py-4 text-sm sm:grid-cols-2">
                {([["Kode proyek", p.code], ["Program", p.programName ?? "—"], ["Jenis kegiatan", ACTIVITY_KIND_LABEL[p.kind]], ["Klien / mitra", p.clientName ?? "—"], ["Moda", DELIVERY_MODE_LABEL[p.deliveryMode]], ["Lokasi / media", p.location ?? "—"],
                  ["Periode", p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : "Belum dijadwalkan"], ["Jenis program", TRACK_LABEL[p.track] + (p.bnsp ? " · BNSP" : "")], ["Peserta acuan", p.participantsMin === null ? "—" : p.participantsMax ? `${p.participantsMin}–${p.participantsMax}` : String(p.participantsMin)], ["Template checklist", p.checklistTemplateName ?? "—"], ["Dibuat", formatDateTime(p.createdAt)], ["Terakhir diubah", formatDateTime(p.updatedAt)]] as [string, string][]).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>)}
                <div className="sm:col-span-2"><dt className="text-xs text-muted">Deskripsi</dt><dd className="whitespace-pre-wrap">{p.description ?? "—"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted">Catatan penting</dt><dd className="whitespace-pre-wrap">{p.notes ?? "—"}</dd></div>
              </dl></Card>
            <Card className="p-5"><ReferencesPanel projectId={id} links={links} refs={refs} canLink={can("link_references")} canSearchLetters={hris} canOpenLetters={hris} /></Card>
          </div>
        );
      })()}

      {tab === "pemantauan" && (async () => {
        const [indicators, milestones, items, workload, dir, members, recovery, workloadEntries] = await Promise.all([
          guard(() => getProgramIndicators(user, id)), guard(() => listMilestones(user, id)), guard(() => listReadiness(user, id)), guard(() => listWorkloadTasks(user, id)),
          can("manage_tasks") ? listDirectory(user).catch(() => null) : Promise.resolve(null), can("manage_tasks") ? listMembers(user, id) : Promise.resolve([]), guard(() => listRecoveryNotes(user, id)),
          can("manage_tasks") ? listWorkloadTemplateEntries(user, id).catch(() => []) : Promise.resolve([]),
        ]);
        // Pemilih staf untuk tugas jam kerja: seluruh direktori bila berwenang; kalau tidak, anggota aktif proyek.
        const employees = dir ? dir.map((d) => ({ id: d.id, name: d.fullName })) : members.filter((m) => m.active).map((m) => ({ id: m.employeeId, name: m.name }));
        return <MonitoringPanel recovery={recovery} canWriteRecovery={can("manage_tasks")} projectId={id} indicators={indicators} milestones={milestones} items={items} workload={workload} workloadEntries={workloadEntries} employees={employees} canUpdate={can("update")} canManageTasks={can("manage_tasks")} canManageChecklist={can("manage_checklist")} editable={editable} canSeeWorkload={can("manage_tasks") || ctx.caps.viewAll} />;
      })()}

      {tab === "tim" && (async () => {
        const [members, dir] = await Promise.all([guard(() => listMembers(user, id)), can("manage_team") ? listDirectory(user).catch(() => null) : Promise.resolve(null)]);
        return <TeamPanel projectId={id} members={members} directory={dir} canManageTeam={can("manage_team")} canManagePic={can("manage_pic")} editable={editable} />;
      })()}

      {tab === "tugas" && (async () => {
        const [tasks, checklist, members, templates] = await Promise.all([
          guard(() => listProjectTasks(user, id)), guard(() => listChecklist(user, id)), guard(() => listMembers(user, id)),
          can("manage_checklist") ? listTemplates(user).catch(() => null) : Promise.resolve(null),
        ]);
        const active = members.filter((m) => m.active).map((m) => ({ employeeId: m.employeeId, name: m.name }));
        return (
          <div className="space-y-8">
            <section aria-label="Tugas"><h2 className="mb-3 text-base font-semibold text-ink">Tugas</h2><TasksPanel tasks={tasks} projectId={id} members={active} canCreate={can("manage_tasks") && editable} /></section>
            <section aria-label="Checklist"><h2 className="mb-3 text-base font-semibold text-ink">Checklist kesiapan</h2><ChecklistPanel projectId={id} data={checklist} templates={templates?.map((t) => ({ id: t.id, name: t.name, itemCount: t.items.length })) ?? null} members={active} editable={editable} /></section>
          </div>
        );
      })()}

      {tab === "jadwal" && (async () => {
        const [schedules, members, instructors] = await Promise.all([guard(() => listProjectSchedules(user, id)), guard(() => listMembers(user, id)), guard(() => listProjectInstructors(user, id))]);
        return <SchedulePanel projectId={id} schedules={schedules} members={members.filter((m) => m.active).map((m) => ({ employeeId: m.employeeId, name: m.name }))} instructors={instructors} canManage={can("manage_schedule")} editable={editable} />;
      })()}

      {tab === "peserta" && (async () => <ParticipantsPanel projectId={id} participants={await guard(() => listProjectParticipants(user, id))} canManage={can("manage_participants")} editable={editable} />)()}

      {tab === "instruktur" && (async () => {
        const [assigned, directory] = await Promise.all([guard(() => listProjectInstructors(user, id)), guard(() => listInstructors(user))]);
        return <ProjectInstructorsPanel projectId={id} assigned={assigned} directory={directory} canManage={can("manage_instructors")} editable={editable} />;
      })()}

      {tab === "dokumen" && (async () => {
        const docs = await guard(() => listDocuments(user, id));
        return <DocumentsPanel projectId={id} items={docs.items} hiddenSensitive={docs.hiddenSensitive} canUpload={can("upload_document")} canManageParticipants={can("manage_participants")} maxMb={env().MAX_DOCUMENT_UPLOAD_MB} editable={editable} />;
      })()}

      {tab === "riwayat" && (async () => {
        const log = await guard(() => listProjectActivity(user, id, Number(sp.page) || 1));
        return (
          <Card><CardHeader title="Riwayat aktivitas" description="Perubahan penting pada proyek ini, terbaru di atas." />
            {log.items.length === 0 ? <EmptyState title="Belum ada riwayat" /> : <ul className="divide-y divide-line">{log.items.map((a) => <li key={a.id} className="px-5 py-3 text-sm"><p className="text-ink">{a.summary ?? a.action}</p><p className="text-xs text-muted">{a.actorName ?? "Sistem"} · {formatDateTime(a.at)}{a.reason ? ` · Alasan: ${a.reason}` : ""}</p></li>)}</ul>}
            <Pagination page={log.page} pageCount={log.pageCount} total={log.total} hrefFor={(n) => `${base}${buildQuery({ tab: "riwayat", page: n })}`} />
          </Card>
        );
      })()}

      {tab === "penutupan" && (async () => <ClosurePanel project={p} preview={await guard(() => getClosurePreview(user, id))} canClose={can("close")} />)()}

      <p className="mt-8 text-xs text-muted"><Link href="/training/proyek" className="hover:underline">← Kembali ke daftar proyek</Link>{p.closedAt && <> · Ditutup {formatDateLong(p.closedAt)}</>}</p>
    </div>
  );
}
