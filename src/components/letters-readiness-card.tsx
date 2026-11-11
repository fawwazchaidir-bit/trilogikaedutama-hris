import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEVERITY_LABEL, type ReadinessReport, type ReadinessSeverity } from "@/lib/letters-readiness";

const TONE: Record<ReadinessSeverity, "green" | "amber" | "red"> = { OK: "green", WARN: "amber", ERROR: "red" };

/** Kesiapan Persuratan untuk surat tugas & uang harian (Pengaturan, Super Admin). Uji mesin PDF lengkap: `npm run check:config` di server. */
export function LettersReadinessCard({ report }: { report: ReadinessReport }) {
  const head = report.canCreateAssignments
    ? "Surat tugas baru dapat dibuat." : report.errors > 0 ? `Ada ${report.errors} masalah yang menghalangi pembuatan/penerbitan surat tugas.` : "Surat tugas baru belum dapat dibuat (Persuratan belum aktif).";
  return (
    <Card>
      <CardHeader title="Kesiapan Persuratan" description={`${head} Pembuatan surat tugas hanya lewat Persuratan. Sebelum deployment jalankan \`npm run check:config -- --strict\` (termasuk uji mesin PDF).`} />
      <ul className="divide-y divide-line px-5 pb-4 text-sm" data-testid="letters-readiness">
        {report.checks.map((c) => (
          <li key={c.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
            <Badge tone={TONE[c.severity]}>{SEVERITY_LABEL[c.severity]}</Badge>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">{c.title}</p>
              <p className="text-muted">{c.detail}</p>
              {c.fix && <p className="text-xs text-brand-700">Perbaikan: {c.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
