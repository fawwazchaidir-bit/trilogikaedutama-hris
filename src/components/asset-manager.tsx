"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ReturnAssetDialog } from "@/components/asset-dialogs";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong } from "@/lib/format";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, type AssetCategoryValue, type AssetStatusValue } from "@/lib/assets";
import type { AssetDto } from "@/server/services/assets";

const STATUS_TONE: Record<AssetStatusValue, "green" | "blue" | "red" | "gray"> = { AVAILABLE: "green", ASSIGNED: "blue", LOST: "red", RETIRED: "gray" };
type Dlg = null | { kind: "form"; asset: AssetDto | null } | { kind: "assign"; asset: AssetDto } | { kind: "retire"; asset: AssetDto };
const blank = { name: "", category: "LAPTOP" as AssetCategoryValue, serialNo: "", note: "" };

/** Daftar aset + serah-terima, pengembalian, ubah, nonaktifkan. `canManage` = HR / Super Admin (`employee:manage`). */
export function AssetManager({ assets, employees, canManage }: { assets: AssetDto[]; employees: { id: string; name: string; no: string }[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [ret, setRet] = useState<{ id: string; label: string } | null>(null);
  const [form, setForm] = useState(blank);
  const [assign, setAssign] = useState({ employeeId: "", assignedOn: "", note: "" });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  const open = (d: Dlg) => {
    setError(null); setFe({});
    if (d?.kind === "form") setForm(d.asset ? { name: d.asset.name, category: d.asset.category, serialNo: d.asset.serialNo ?? "", note: d.asset.note ?? "" } : blank);
    if (d?.kind === "assign") setAssign({ employeeId: "", assignedOn: "", note: "" });
    if (d?.kind === "retire") setReason("");
    setDlg(d);
  };
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); setDlg(null); router.refresh(); } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  function submit() {
    if (!dlg) return;
    if (dlg.kind === "form") return dlg.asset
      ? run(() => api(`/api/assets/${dlg.asset!.id}`, { method: "PUT", body: form }), "Data aset disimpan.")
      : run(() => api("/api/assets", { body: form }), "Aset didaftarkan.");
    if (dlg.kind === "assign") return run(() => api(`/api/assets/${dlg.asset.id}/assign`, { body: { employeeId: assign.employeeId, assignedOn: assign.assignedOn || undefined, note: assign.note } }), "Aset diserahkan.");
    return run(() => api(`/api/assets/${dlg.asset.id}/retire`, { body: { reason } }), "Aset dinonaktifkan.");
  }

  return (
    <>
      {canManage && <div className="flex justify-end px-5 pb-3"><Button variant="primary" onClick={() => open({ kind: "form", asset: null })}>Daftarkan aset</Button></div>}
      <TableWrap>
        <Table>
          <thead><tr><Th>Kode</Th><Th>Aset</Th><Th>Kategori</Th><Th>Status</Th><Th>Dipegang oleh</Th>{canManage && <Th>Aksi</Th>}</tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap"><Link className="font-medium text-brand-700 hover:underline" href={`/aset/${a.id}`}>{a.code}</Link></Td>
                <Td><p className="font-medium">{a.name}</p>{a.serialNo && <p className="text-xs text-muted">No. seri {a.serialNo}</p>}{a.note && <p className="text-xs text-muted">{a.note}</p>}</Td>
                <Td>{a.categoryLabel}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[a.status]}>{ASSET_STATUS_LABEL[a.status]}</Badge>
                  {a.status === "AVAILABLE" && a.lastCondition === "DAMAGED" && <p className="mt-1 text-xs text-amber-700">Terakhir kembali rusak{a.lastReturnNote ? `: ${a.lastReturnNote}` : ""}</p>}
                  {a.status === "RETIRED" && a.retireReason && <p className="mt-1 text-xs text-muted">{a.retireReason}</p>}
                </Td>
                <Td>{a.holder ? <><Link className="text-brand-700 hover:underline" href={`/karyawan/${a.holder.employeeId}`}>{a.holder.employeeName}</Link><p className="text-xs text-muted">sejak {formatDateLong(a.holder.assignedOn)}</p></> : "—"}</Td>
                {canManage && (
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {a.status === "AVAILABLE" && <Button size="sm" onClick={() => open({ kind: "assign", asset: a })} aria-label={`Serahkan: ${a.name}`}>Serahkan</Button>}
                      {a.status === "ASSIGNED" && <Button size="sm" onClick={() => setRet({ id: a.id, label: `${a.name} (${a.code})` })} aria-label={`Kembalikan: ${a.name}`}>Kembalikan</Button>}
                      {a.status === "LOST" && <Button size="sm" disabled={busy} onClick={() => run(() => api(`/api/assets/${a.id}/found`, { body: {} }), "Aset ditandai ditemukan.")} aria-label={`Ditemukan: ${a.name}`}>Ditemukan</Button>}
                      {a.status !== "RETIRED" && <Button size="sm" onClick={() => open({ kind: "form", asset: a })} aria-label={`Ubah: ${a.name}`}>Ubah</Button>}
                      {(a.status === "AVAILABLE" || a.status === "LOST") && <Button size="sm" onClick={() => open({ kind: "retire", asset: a })} aria-label={`Nonaktifkan: ${a.name}`}>Nonaktifkan</Button>}
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {error && !dlg && <div className="px-5 py-3"><Notice tone="danger">{error}</Notice></div>}

      <ReturnAssetDialog asset={ret} onClose={() => setRet(null)} onDone={() => { setRet(null); router.refresh(); }} />

      <Dialog open={!!dlg} onClose={() => !busy && setDlg(null)} size="md"
        title={dlg?.kind === "form" ? (dlg.asset ? `Ubah aset ${dlg.asset.code}` : "Daftarkan aset") : dlg?.kind === "assign" ? `Serahkan: ${dlg.asset.name}` : dlg?.kind === "retire" ? `Nonaktifkan: ${dlg.asset.name}` : ""}
        footer={<><Button onClick={() => setDlg(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={submit}>{dlg?.kind === "assign" ? "Serahkan" : dlg?.kind === "retire" ? "Nonaktifkan" : "Simpan"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {dlg?.kind === "form" && (
            <>
              <TextField label="Nama aset" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fe.name} hint="Mis. Laptop Lenovo ThinkPad E14" />
              <SelectField label="Kategori" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as AssetCategoryValue })} error={fe.category}>
                {ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>)}
              </SelectField>
              <TextField label="Nomor seri (opsional)" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} error={fe.serialNo} />
              <TextAreaField label="Catatan (opsional)" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={fe.note} />
            </>
          )}
          {dlg?.kind === "assign" && (
            <>
              <SelectField label="Diserahkan kepada" required value={assign.employeeId} onChange={(e) => setAssign({ ...assign, employeeId: e.target.value })} error={fe.employeeId}>
                <option value="">— pilih karyawan —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.no})</option>)}
              </SelectField>
              <TextField label="Tanggal serah-terima" type="date" value={assign.assignedOn} onChange={(e) => setAssign({ ...assign, assignedOn: e.target.value })} error={fe.assignedOn} hint="Kosong = hari ini." />
              <TextAreaField label="Catatan (opsional)" rows={2} value={assign.note} onChange={(e) => setAssign({ ...assign, note: e.target.value })} error={fe.note} hint="Mis. kelengkapan: charger, tas." />
            </>
          )}
          {dlg?.kind === "retire" && (
            <>
              <Notice tone="warn">Aset yang dinonaktifkan tidak muncul lagi untuk diserahkan dan tidak dapat diaktifkan kembali. Riwayatnya tetap tersimpan.</Notice>
              <TextAreaField label="Alasan" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} error={fe.reason} />
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
