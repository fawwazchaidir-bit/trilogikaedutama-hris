"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong } from "@/lib/format";

export interface CorrectionTarget { employeeId: string; name: string; employeeNo: string; date: string; checkIn: string | null; checkOut: string | null; hasRecord: boolean }

export function CorrectionButton({ target }: { target: CorrectionTarget }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ checkIn: target.checkIn ?? "08:00", checkOut: target.checkOut ?? "", note: "", reason: "" });
  const [mode, setMode] = useState<"set" | "remove">("set");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      const body = mode === "remove" ? { employeeId: target.employeeId, date: target.date, action: "remove", reason: f.reason }
        : { employeeId: target.employeeId, date: target.date, action: "set", checkIn: f.checkIn, checkOut: f.checkOut || null, checkInNote: f.note, reason: f.reason };
      const r = await api<{ payrollNotices: string[] }>("/api/attendance/correct", { body });
      toast.success(mode === "remove" ? "Catatan absensi dihapus." : "Koreksi absensi disimpan.");
      r.payrollNotices.forEach((n) => toast.error(n));
      setOpen(false); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setFe({}); setOpen(true); }} aria-label={`Koreksi absensi ${target.name}`}><Pencil className="size-3.5" />Koreksi</Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="md" title={`Koreksi absensi — ${target.name}`} description={`${target.employeeNo} · ${formatDateLong(target.date)}. Sebelum/sesudah, waktu, dan pelaku koreksi dicatat permanen.`}
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant={mode === "remove" ? "danger" : "primary"} loading={busy} onClick={save}>{mode === "remove" ? "Hapus catatan" : "Simpan koreksi"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {target.hasRecord && (
            <div className="flex gap-2 text-sm" role="radiogroup" aria-label="Jenis koreksi">
              <label className={`flex-1 cursor-pointer rounded-md border px-3 py-2 ${mode === "set" ? "border-brand-600 bg-brand-50" : "border-line"}`}><input type="radio" className="mr-2" checked={mode === "set"} onChange={() => setMode("set")} />Ubah jam</label>
              <label className={`flex-1 cursor-pointer rounded-md border px-3 py-2 ${mode === "remove" ? "border-brand-600 bg-brand-50" : "border-line"}`}><input type="radio" className="mr-2" checked={mode === "remove"} onChange={() => setMode("remove")} />Hapus catatan</label>
            </div>
          )}
          {mode === "set" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Jam check-in (WIB)" type="time" required value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} error={fe.checkIn} />
              <TextField label="Jam check-out (WIB)" type="time" value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} error={fe.checkOut} hint="Kosongkan bila memang belum check-out" />
              <div className="sm:col-span-2"><TextField label="Catatan absensi (opsional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
            </div>
          )}
          <TextAreaField label="Alasan koreksi (wajib)" rows={3} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={fe.reason} placeholder="mis. Lupa check-in; terverifikasi oleh atasan langsung" />
        </div>
      </Dialog>
    </>
  );
}
