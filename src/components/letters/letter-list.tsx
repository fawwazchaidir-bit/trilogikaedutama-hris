"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { LETTER_SERIES_LABEL, type LetterStatus } from "@/lib/documents/policy";
import type { LetterDto } from "@/server/services/letters/documents";
import type { LetterTypeDto } from "@/server/services/letters/types";

const TONE: Record<LetterStatus, "gray" | "amber" | "green" | "red" | "blue"> = { DRAFT: "gray", IN_REVIEW: "amber", RETURNED: "blue", ISSUED: "green", REJECTED: "red", CANCELLED: "red" };
const date = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

export function LetterTable({ items, showCreator }: { items: LetterDto[]; showCreator?: boolean }) {
  if (items.length === 0) return <EmptyState title="Belum ada surat" description="Surat yang Anda buat atau perlu Anda tanda tangani akan muncul di sini." />;
  return (
    <TableWrap>
      <Table>
        <thead><tr><Th>Nomor</Th><Th>Jenis</Th><Th>Perihal</Th>{showCreator && <Th>Pembuat</Th>}<Th>Penandatangan</Th><Th>Status</Th><Th>Diperbarui</Th></tr></thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id} className="hover:bg-canvas">
              <Td mono>{l.number ?? "—"}</Td>
              <Td><Link href={`/persuratan/${l.id}`} className="font-medium text-brand-700 hover:underline">{l.typeName}</Link><span className="block text-xs text-muted">{LETTER_SERIES_LABEL[l.series]}</span></Td>
              <Td>{l.subject || <span className="text-muted">—</span>}</Td>
              {showCreator && <Td>{l.creatorName}</Td>}
              <Td>{l.signerName ?? <span className="text-muted">Belum dipilih</span>}</Td>
              <Td><Badge tone={TONE[l.status]}>{l.statusLabel}</Badge></Td>
              <Td>{date(l.updatedAt)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

/** Tombol + dialog pemilih jenis untuk membuat draf baru. */
export function NewLetterButton({ types }: { types: LetterTypeDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [archive, setArchive] = useState(false);
  async function pick(id: string) {
    setBusy(id);
    try { const d = await api<{ id: string }>("/api/letters", { body: { typeId: id, archiveOnly: archive || undefined } }); router.push(`/persuratan/${d.id}`); }
    catch (e) { toast.error(errorMessage(e)); setBusy(null); }
  }
  const groups = (["EKS", "INT"] as const).map((s) => ({ s, list: types.filter((t) => t.series === s) })).filter((g) => g.list.length);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}><FilePlus2 className="size-4" />Buat surat</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Pilih jenis surat" description="Isi awal mengikuti templat jenis yang dipilih. Nomor surat diberikan otomatis saat disetujui penandatangan.">
        <div className="space-y-4">
          <label className="flex items-start gap-2 rounded-lg border border-line bg-canvas p-3 text-sm"><input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} className="mt-0.5" /><span><b>Surat dibuat di luar portal (arsip saja)</b><span className="block text-xs text-muted">Hanya minta nomor resmi dan unggah PDF pindaian tanda tangan basah sesudahnya (mis. MoU/PKS).</span></span></label>
          {groups.map((g) => (
            <section key={g.s}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Surat {LETTER_SERIES_LABEL[g.s]}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {g.list.map((t) => (
                  <li key={t.id}>
                    <button type="button" disabled={busy !== null} onClick={() => void pick(t.id)} className="w-full rounded-lg border border-line bg-white p-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50 disabled:opacity-60">
                      <span className="flex items-center justify-between gap-2"><span className="font-medium text-ink">{t.name}</span><span className="font-mono text-xs text-muted">{t.series}-{t.codeText}</span></span>
                      {t.description && <span className="mt-0.5 block text-xs text-muted">{t.description}</span>}
                      <span className="mt-1 block text-[11px] text-ink-soft">{t.directorOnly ? "Ditandatangani Direktur" : "Ditandatangani Direktur / Manajer"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Dialog>
    </>
  );
}
