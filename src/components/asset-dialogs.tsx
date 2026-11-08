"use client";
import { useState } from "react";
import { Notice } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { ASSET_CONDITIONS, ASSET_CONDITION_LABEL, type AssetConditionValue } from "@/lib/assets";

/** Dialog pencatatan pengembalian aset (dipakai di daftar Aset dan kartu aset pada detail karyawan). Rusak/hilang wajib berketerangan. */
export function ReturnAssetDialog({ asset, onClose, onDone }: { asset: { id: string; label: string } | null; onClose: () => void; onDone: () => void }) {
  return asset ? <ReturnForm key={asset.id} asset={asset} onClose={onClose} onDone={onDone} /> : null;
}

function ReturnForm({ asset, onClose, onDone }: { asset: { id: string; label: string }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<{ condition: AssetConditionValue; returnedOn: string; note: string }>({ condition: "GOOD", returnedOn: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      await api(`/api/assets/${asset.id}/return`, { body: { condition: form.condition, returnedOn: form.returnedOn || undefined, note: form.note } });
      toast.success(form.condition === "LOST" ? "Pengembalian dicatat; aset ditandai hilang." : "Pengembalian dicatat.");
      onDone();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  return (
    <Dialog open onClose={() => !busy && onClose()} size="md" title={`Catat pengembalian: ${asset.label}`}
      footer={<><Button onClick={onClose} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan pengembalian</Button></>}>
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        <SelectField label="Kondisi saat dikembalikan" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value as AssetConditionValue })} error={fe.condition}>
          {ASSET_CONDITIONS.map((c) => <option key={c} value={c}>{c === "LOST" ? "Hilang (tidak dikembalikan)" : ASSET_CONDITION_LABEL[c]}</option>)}
        </SelectField>
        <TextField label="Tanggal pengembalian" type="date" value={form.returnedOn} onChange={(e) => setForm({ ...form, returnedOn: e.target.value })} error={fe.returnedOn} hint="Kosong = hari ini." />
        <TextAreaField label={form.condition === "GOOD" ? "Catatan (opsional)" : "Keterangan kerusakan / kehilangan"} required={form.condition !== "GOOD"} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={fe.note} />
        {form.condition === "LOST" && <Notice tone="warn">Aset hilang tidak otomatis memotong gaji. Potongan upah dibatasi aturan; putuskan penanganannya secara terpisah.</Notice>}
      </div>
    </Dialog>
  );
}
