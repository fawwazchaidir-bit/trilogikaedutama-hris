import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, UserRound } from "lucide-react";
import { requirePageSelf } from "@/server/auth/current";
import { getEmployee } from "@/server/services/employees";
import { getEmployeeRange } from "@/server/services/attendance";
import { env } from "@/server/env";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DayStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { dotTime, formatDateCompact, formatDateLong } from "@/lib/format";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import { addDays, todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Profil & Jadwal" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requirePageSelf();
  const today = todayIso(env().APP_TIMEZONE);
  const [e, week] = await Promise.all([getEmployee(user, user.employeeId), getEmployeeRange(user, user.employeeId, today, addDays(today, 13))]);
  const row = (k: string, v: React.ReactNode) => (<div className="grid grid-cols-[8rem_1fr] gap-2 py-2 text-sm"><dt className="text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>);
  return (
    <div>
      <PageHeader title="Profil & Jadwal" description="Data kepegawaian Anda. Untuk perubahan data, hubungi Admin/HR." actions={<Link href="/change-password" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-canvas"><KeyRound className="size-4" />Ganti password</Link>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <Card>
          <div className="flex items-center gap-4 border-b border-line p-5">
            {e.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={e.photoUrl} alt="" className="size-16 rounded-full border border-line object-cover" />
              : <span className="grid size-16 place-items-center rounded-full bg-brand-50 text-brand-700"><UserRound className="size-8" /></span>}
            <div><p className="text-lg font-semibold">{e.fullName}</p><p className="text-sm text-muted">{e.position}{e.divisionName ? ` · ${e.divisionName}` : ""}</p><div className="mt-1 flex gap-1"><Badge>{EMPLOYMENT_LABEL[e.employmentStatus]}</Badge>{!e.isActive && <Badge tone="red">Nonaktif</Badge>}</div></div>
          </div>
          <dl className="divide-y divide-line px-5">
            {row("No. Induk", e.employeeNo)}{row("Mulai bekerja", formatDateLong(e.joinDate))}{row("Telepon", e.phone)}{row("Email", e.email)}{row("Alamat", e.address)}
            {row("Rekening gaji", e.bankAccountMasked ? `${e.bankName ?? ""} ${e.bankAccountMasked}` : null)}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Jadwal kerja 14 hari ke depan" description="Sesuai jadwal yang berlaku bagi Anda, hari libur, dan pengajuan yang sudah disetujui." />
          <TableWrap><Table>
            <thead><tr><Th>Tanggal</Th><Th>Jam kerja</Th><Th>Jadwal</Th><Th>Keterangan</Th></tr></thead>
            <tbody>{week.days.map((d) => (
              <tr key={d.date} className={d.scheduled ? "" : "bg-canvas/60 text-muted"}>
                <Td className="whitespace-nowrap font-medium">{formatDateCompact(d.date)}</Td>
                <Td className="whitespace-nowrap">{d.scheduled ? `${dotTime(d.scheduleStart!)} – ${dotTime(d.scheduleEnd!)}` : "—"}</Td>
                <Td>{d.scheduled ? d.scheduleName : "—"}</Td>
                <Td>{d.scheduled ? (d.status === "IZIN" || d.status === "SAKIT" || d.status === "CUTI" || d.checkInAt ? <DayStatusBadge status={d.status} missingCheckout={d.missingCheckout} /> : "Hari kerja") : (d.offReason ?? "Libur")}</Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        </Card>
      </div>
    </div>
  );
}
