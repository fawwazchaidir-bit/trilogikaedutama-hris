import type { Metadata } from "next";
import { requirePageSelf } from "@/server/auth/current";
import { listMyOvertime, OVERTIME_MAX_AHEAD_DAYS } from "@/server/services/overtime";
import { getSettings } from "@/server/services/settings";
import { env } from "@/server/env";
import { PageHeader } from "@/components/ui/card";
import { MyOvertimeList, OvertimeForm } from "@/components/overtime-forms";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Lembur Saya" };
export const dynamic = "force-dynamic";

export default async function MyOvertimePage() {
  const user = await requirePageSelf();
  const [items, settings] = await Promise.all([listMyOvertime(user), getSettings()]);
  return (
    <div>
      <PageHeader title="Lembur Saya" description="Ajukan lembur dan pantau persetujuannya. Hanya lembur yang disetujui dan terbukti pada absensi (check-out melewati jam pulang) yang dibayarkan, sesuai aturan penggajian perusahaan." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <OvertimeForm today={todayIso(env().APP_TIMEZONE)} maxBackdateDays={settings.requestBackdateDays} maxAheadDays={OVERTIME_MAX_AHEAD_DAYS} />
        <MyOvertimeList items={items} />
      </div>
    </div>
  );
}
