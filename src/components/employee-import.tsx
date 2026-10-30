"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import type { ImportPreview } from "@/server/services/employee-import";

const ACTION = { create: ["green", "Baru"], update: ["blue", "Perbarui"], skip: ["gray", "Dilewati"], error: ["red", "Bermasalah"] } as const;

async function send(file: File, mode: string, commit: boolean): Promise<ImportPreview> {
  const form = new FormData();
  form.append("file", file); form.append("mode", mode); if (commit) form.append("commit", "1");
  const res = await fetch("/api/employees/import", { method: "POST", body: form, credentials: "same-origin" });
  const json = (await res.json().catch(() => ({}))) as { data?: ImportPreview; error?: { message?: string; code?: string } };
  if (!res.ok || !json.data) throw new ApiClientError(json.error?.message ?? "Gagal memproses file.", res.status, json.error?.code ?? "UNKNOWN");
  return json.data;
}

export function EmployeeImport() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setOpen(false); setFile(null); setPreview(null); setError(null); };

  async function check(f: File | null, m = mode) {
    setFile(f); setPreview(null); setError(null);
    if (!f) return;
    setBusy(true);
    try { setPreview(await send(f, m, false)); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function commit() {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const r = await send(file, mode, true);
      toast.success(`Impor selesai: ${r.counts.create} baru, ${r.counts.update} diperbarui, ${r.counts.skip} dilewati.`);
      reset(); router.refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}><Upload className="size-4" />Impor</Button>
      <Dialog open={open} onClose={() => !busy && reset()} size="xl" title="Impor data karyawan" description="Unggah file Excel (.xlsx) atau CSV. Periksa pratinjau sebelum menyimpan; bila ada baris bermasalah, tidak ada data yang disimpan."
        footer={<><Button onClick={reset} disabled={busy}>Tutup</Button><Button variant="primary" loading={busy} disabled={!preview || preview.counts.error > 0 || preview.counts.create + preview.counts.update === 0} onClick={commit}>Simpan {preview ? preview.counts.create + preview.counts.update : 0} baris</Button></>}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5"><label htmlFor="imp-file" className="block text-sm font-medium text-ink-soft">File impor</label>
              <input id="imp-file" type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void check(e.target.files?.[0] ?? null)} className="block text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 hover:file:bg-canvas" /></div>
            <div className="space-y-1.5"><label htmlFor="imp-mode" className="block text-sm font-medium text-ink-soft">Bila nomor induk sudah ada</label>
              <select id="imp-mode" value={mode} onChange={(e) => { const m = e.target.value as "skip" | "update"; setMode(m); void check(file, m); }} className="h-10 rounded-md border border-line bg-white px-3 text-sm"><option value="skip">Lewati baris itu</option><option value="update">Perbarui (kolom kosong tidak menimpa)</option></select></div>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- unduhan berkas, bukan navigasi halaman */}
            <a href="/api/employees/import/template" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm hover:bg-canvas"><Download className="size-4" />Unduh templat</a>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          {preview && (<>
            <div className="flex flex-wrap gap-2 text-sm">{(Object.keys(ACTION) as (keyof typeof ACTION)[]).map((k) => <Badge key={k} tone={ACTION[k][0]}>{ACTION[k][1]}: {preview.counts[k]}</Badge>)}</div>
            {preview.newDivisions.length > 0 && <Notice tone="info">Divisi baru yang akan dibuat: {preview.newDivisions.join(", ")}.</Notice>}
            {preview.unknownColumns.length > 0 && <Notice tone="warn">Kolom tidak dikenali dan diabaikan: {preview.unknownColumns.join(", ")}.</Notice>}
            <TableWrap className="max-h-96 overflow-y-auto"><Table>
              <thead><tr><Th>Baris</Th><Th>No. Induk</Th><Th>Nama</Th><Th>Hasil</Th><Th>Keterangan</Th></tr></thead>
              <tbody>{preview.rows.map((r) => (
                <tr key={r.line}><Td>{r.line}</Td><Td mono>{r.employeeNo || "—"}</Td><Td>{r.fullName || "—"}</Td><Td><Badge tone={ACTION[r.action][0]}>{ACTION[r.action][1]}</Badge></Td>
                  <Td className="text-brand-700">{r.errors.length ? r.errors.join("; ") : <span className="text-muted">{r.note ?? ""}</span>}</Td></tr>
              ))}</tbody>
            </Table></TableWrap>
          </>)}
        </div>
      </Dialog>
    </>
  );
}
