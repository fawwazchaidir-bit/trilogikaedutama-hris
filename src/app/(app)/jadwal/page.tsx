import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { listAssignments, listCalendar, listSchedules } from "@/server/services/schedules";
import { listDivisions, listEmployeeOptions } from "@/server/services/employees";
import { env } from "@/server/env";
import { PageHeader } from "@/components/ui/card";
import { AssignmentsCard, CalendarCard, SchedulesCard } from "@/components/schedule-manager";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Jadwal & Libur" };
export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("schedule:manage");
  const sp = await flattenSearchParams(searchParams);
  const year = Number(sp.year) >= 2000 && Number(sp.year) <= 2100 ? Number(sp.year) : Number(todayIso(env().APP_TIMEZONE).slice(0, 4));
  const [schedules, assignments, calendar, divisions, employees] = await Promise.all([
    listSchedules(user), listAssignments(user), listCalendar(user, year), listDivisions(user), listEmployeeOptions(user),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Jadwal & Libur" description="Atur hari dan jam kerja, penugasan per divisi/karyawan, serta kalender libur. Perubahan langsung memengaruhi rekap absensi (hari yang sudah terbit di slip gaji tidak berubah)." />
      <SchedulesCard schedules={schedules} />
      <AssignmentsCard assignments={assignments} schedules={schedules} divisions={divisions} employees={employees.map((e) => ({ id: e.id, name: `${e.fullName} (${e.employeeNo})` }))} />
      <CalendarCard year={year} items={calendar} />
    </div>
  );
}
