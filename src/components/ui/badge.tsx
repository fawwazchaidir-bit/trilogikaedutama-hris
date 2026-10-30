import { cn } from "@/lib/cn";
import { STATUS_LABEL, type DayStatus } from "@/lib/attendance";
import { PAYROLL_STATUS_LABEL, REQUEST_STATUS_LABEL, type PayrollStatus, type RequestStatus } from "@/lib/labels";

type Tone = "gray" | "green" | "amber" | "red" | "blue" | "dark";

const TONES: Record<Tone, string> = {
  gray: "bg-stone-100 text-stone-700 ring-stone-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-brand-50 text-brand-700 ring-brand-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  dark: "bg-ink text-white ring-ink",
};

export function Badge({ tone = "gray", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

const DAY_TONE: Record<DayStatus, Tone> = {
  HADIR: "green", TERLAMBAT: "amber", IZIN: "blue", SAKIT: "blue", CUTI: "blue", TIDAK_HADIR: "red",
  LIBUR: "gray", BELUM_ABSEN: "amber", MENDATANG: "gray", DI_LUAR_MASA_KERJA: "gray",
};

export function DayStatusBadge({ status, missingCheckout }: { status: DayStatus; missingCheckout?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={DAY_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      {missingCheckout && <Badge tone="amber">Belum check-out</Badge>}
    </span>
  );
}

const REQ_TONE: Record<RequestStatus, Tone> = { PENDING: "amber", APPROVED: "green", REJECTED: "red", CANCELLED: "gray" };
export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge tone={REQ_TONE[status]}>{REQUEST_STATUS_LABEL[status]}</Badge>;
}

const PAY_TONE: Record<PayrollStatus, Tone> = { DRAFT: "gray", PENDING_APPROVAL: "amber", APPROVED: "blue", ISSUED: "green", CANCELLED: "dark" };
export function PayrollStatusBadge({ status }: { status: PayrollStatus }) {
  return <Badge tone={PAY_TONE[status]}>{PAYROLL_STATUS_LABEL[status]}</Badge>;
}
