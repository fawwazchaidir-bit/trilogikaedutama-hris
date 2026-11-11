import { Card, CardHeader } from "@/components/ui/card";
import { HandoverList } from "@/components/training/handover-list";
import type { HandoverDto } from "@/server/services/training/handover";

/** Kartu di detail karyawan yang sudah berhenti: pekerjaan Training yang masih tercatat atas namanya (perlu dialihkan oleh PIC/Koordinator). */
export function EmployeeHandoverCard({ handover }: { handover: HandoverDto }) {
  return (
    <Card>
      <CardHeader title="Serah terima Training" description="Pekerjaan yang masih tercatat atas nama karyawan ini. PIC proyek (atau Koordinator Program bila PIC-nya yang berhenti) sudah diberi tahu; tidak ada yang dialihkan otomatis." />
      <div className="px-5 pb-4"><HandoverList handover={handover} /></div>
    </Card>
  );
}
