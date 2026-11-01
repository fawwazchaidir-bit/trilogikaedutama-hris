"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateShort, formatDateTime } from "@/lib/format";
import type { LocationCheckDto } from "@/server/services/location";

const DECISION_TONE = { ACCEPTED: "green", FLAGGED: "amber", BLOCKED: "red" } as const;
const DECISION_LABEL = { ACCEPTED: "Diterima", FLAGGED: "Ditandai (diterima)", BLOCKED: "Ditolak" } as const;
const REVIEW_LABEL = { OPEN: "Perlu ditinjau", CLEARED: "Dinyatakan wajar", CONFIRMED: "Indikasi manipulasi" } as const;

export function LocationReviewTable({ items, canReview }: { items: LocationCheckDto[]; canReview: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<{ kind: "CLEARED" | "CONFIRMED"; item: LocationCheckDto } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const close = () => { setAction(null); setNote(""); setError(null); setFe({}); };

  async function submit() {
    if (!action) return;
    setBusy(true); setError(null); setFe({});
    try {
      await api(`/api/location/${action.item.id}/review`, { body: { decision: action.kind, note } });
      toast.success(action.kind === "CLEARED" ? "Dinyatakan wajar." : "Ditandai sebagai indikasi manipulasi.");
      close(); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  return (
    <>
      {items.length === 0 ? <EmptyState title="Tidak ada catatan" description="Belum ada absensi lokasi yang ditandai pada filter ini." /> : (
        <TableWrap><Table>
          <thead><tr><Th>Karyawan</Th><Th>Absen</Th><Th align="right">Skor</Th><Th>Sinyal</Th><Th>Keputusan</Th><Th>Tinjauan</Th>{canReview && <Th align="right">Aksi</Th>}</tr></thead>
          <tbody>{items.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.employeeName}<span className="block text-xs font-normal text-muted">{c.employeeNo}</span></Td>
              <Td className="whitespace-nowrap">{c.kind === "CHECK_IN" ? "Check-in" : "Check-out"} · {formatDateShort(c.date)}<span className="block text-xs text-muted">{formatDateTime(c.createdAt)}{c.distance !== null ? ` · ${c.distance} m dari titik` : ""}{c.accuracy !== null ? ` · ±${Math.round(c.accuracy)} m` : ""}</span></Td>
              <Td align="right" className={c.riskScore >= 70 ? "font-semibold text-brand-700" : c.riskScore >= 50 ? "font-semibold text-amber-700" : ""}>{c.riskScore}</Td>
              <Td className="min-w-64"><ul className="list-disc space-y-0.5 pl-4 text-xs">{c.flags.map((f) => <li key={f.code}>{f.label}</li>)}</ul>
                <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {c.mapUrl && <a href={c.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><ExternalLink className="size-3" />Lihat titik di peta</a>}
                  {c.photoUrl && <a href={c.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"><Camera className="size-3" />Lihat foto absensi</a>}
                </span></Td>
              <Td><Badge tone={DECISION_TONE[c.decision]}>{DECISION_LABEL[c.decision]}</Badge></Td>
              <Td>{c.reviewStatus ? <Badge tone={c.reviewStatus === "OPEN" ? "amber" : c.reviewStatus === "CONFIRMED" ? "red" : "green"}>{REVIEW_LABEL[c.reviewStatus]}</Badge> : "—"}
                {c.reviewedBy && <span className="mt-1 block text-xs text-muted">{c.reviewedBy}, {formatDateTime(c.reviewedAt)}{c.reviewNote ? ` · ${c.reviewNote}` : ""}</span>}</Td>
              {canReview && <Td align="right">{c.reviewStatus === "OPEN" && <div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => setAction({ kind: "CLEARED", item: c })} aria-label={`Nyatakan wajar ${c.employeeName}`}>Wajar</Button>
                <Button size="sm" variant="danger" onClick={() => setAction({ kind: "CONFIRMED", item: c })} aria-label={`Tandai manipulasi ${c.employeeName}`}>Indikasi manipulasi</Button></div>}</Td>}
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={!!action} onClose={() => !busy && close()} size="sm" title={action?.kind === "CLEARED" ? "Nyatakan wajar" : "Tandai indikasi manipulasi"}
        description={action ? `${action.item.employeeName} · ${action.item.kind === "CHECK_IN" ? "check-in" : "check-out"} ${formatDateShort(action.item.date)} · skor ${action.item.riskScore}` : undefined}
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant={action?.kind === "CONFIRMED" ? "danger" : "primary"} loading={busy} onClick={submit}>Simpan tinjauan</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {action?.kind === "CONFIRMED" && <Notice tone="warn">Ini hanya mencatat tinjauan. Bila absensi perlu diubah, gunakan <strong>Koreksi absensi</strong> (beralasan, tercatat). Skor adalah indikator, bukan bukti — verifikasi dengan karyawan/atasan sebelum bertindak.</Notice>}
          <TextAreaField label="Catatan tinjauan (wajib)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={fe.note} placeholder={action?.kind === "CLEARED" ? "mis. Karyawan memakai laptop kantor; posisi jaringan identik setiap hari" : "mis. Dikonfirmasi atasan: karyawan tidak berada di kantor"} />
        </div>
      </Dialog>
    </>
  );
}
