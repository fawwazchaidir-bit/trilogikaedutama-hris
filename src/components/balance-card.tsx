"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateTime, formatDays } from "@/lib/format";
import { LEDGER_KIND_LABEL } from "@/lib/labels";
import type { BalanceDto, LedgerDto } from "@/server/services/leave";

export function BalanceCard({ employeeId, balance, ledger, canManage }: { employeeId: string; balance: BalanceDto; ledger: LedgerDto[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(String(balance.balance));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      await api("/api/leave-balance", { body: { employeeId, year: balance.year, targetDays: Number(target), note } });
      toast.success("Saldo cuti diperbarui."); setOpen(false); setNote(""); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader title={`Saldo cuti ${balance.year}`} description="Setiap perubahan tercatat permanen (tidak dapat diubah). Pengajuan cuti yang disetujui memotong saldo otomatis."
        actions={canManage ? <Button onClick={() => { setError(null); setFe({}); setTarget(String(balance.balance)); setOpen(true); }}>Atur saldo</Button> : undefined} />
      <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
        <Tile label="Saldo" value={`${formatDays(balance.balance)} hari`} tone={balance.balance < 0 ? "red" : undefined} />
        <Tile label="Menunggu persetujuan" value={`${formatDays(balance.reserved)} hari`} tone={balance.reserved ? "amber" : undefined} />
        <Tile label="Tersedia diajukan" value={`${formatDays(balance.available)} hari`} tone="green" />
        <Tile label="Terpakai" value={`${formatDays(Math.abs(balance.used + balance.restored))} hari`} />
      </div>
      {ledger.length === 0 ? <EmptyState title="Belum ada riwayat saldo" /> : (
        <TableWrap><Table>
          <thead><tr><Th>Waktu</Th><Th>Jenis</Th><Th align="right">Hari</Th><Th>Catatan</Th><Th>Oleh</Th></tr></thead>
          <tbody>{ledger.map((l) => (<tr key={l.id}><Td className="whitespace-nowrap">{formatDateTime(l.createdAt)}</Td><Td>{LEDGER_KIND_LABEL[l.kind as keyof typeof LEDGER_KIND_LABEL] ?? l.kind}</Td><Td align="right">{l.days > 0 ? `+${formatDays(l.days)}` : formatDays(l.days)}</Td><Td className="text-muted">{l.note ?? "—"}</Td><Td>{l.createdBy}</Td></tr>))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="sm" title={`Atur saldo cuti ${balance.year}`} description="Masukkan saldo yang diinginkan; sistem mencatat selisihnya sebagai penyesuaian."
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan</Button></>}>
        <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Saldo (hari)" type="number" step={0.5} required value={target} onChange={(e) => setTarget(e.target.value)} error={fe.targetDays} hint={`Saat ini ${formatDays(balance.balance)} hari (boleh kelipatan 0,5)`} />
          <TextAreaField label="Catatan (wajib)" rows={2} required value={note} onChange={(e) => setNote(e.target.value)} error={fe.note} placeholder="mis. saldo awal sesuai kebijakan / koreksi karena …" /></div>
      </Dialog>
    </Card>
  );
}
