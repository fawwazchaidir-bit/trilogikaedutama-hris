"use client";
import { useState } from "react";
import { Ban, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import type { ProjectAbility } from "@/lib/training/access";
import { isFinalProject, type ProjectStatus } from "@/lib/training/types";
import { useRunner } from "./use-runner";

/** Tombol alur status proyek (hanya yang diizinkan). Penutupan ada di tab "Penutupan". */
export function ProjectActions({ id, status, abilities }: { id: string; status: ProjectStatus; abilities: ProjectAbility[] }) {
  const { busy, error, run, reset } = useRunner();
  const [dlg, setDlg] = useState<"cancel" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const can = (a: ProjectAbility) => abilities.includes(a);
  const next = status === "DRAFT" ? { to: "PREPARATION", label: "Mulai persiapan" } : status === "PREPARATION" ? { to: "RUNNING", label: "Mulai pelaksanaan" } : null;
  const open = (d: "cancel" | "reopen") => { reset(); setReason(""); setDlg(d); };
  const submit = () => run(() => api(`/api/training/projects/${id}/${dlg}`, { body: { reason } }), dlg === "cancel" ? "Proyek dibatalkan." : "Proyek dibuka kembali.", () => setDlg(null));

  return (
    <>
      {next && can("change_status") && (
        <Button variant="primary" loading={busy} onClick={() => void run(() => api(`/api/training/projects/${id}/status`, { body: { to: next.to } }), `Status proyek: ${next.label.replace("Mulai ", "")}.`)}><Play className="size-4" />{next.label}</Button>
      )}
      {error && !dlg && <span role="alert" className="max-w-sm text-xs font-medium text-brand-700">{error}</span>}
      {status === "COMPLETED" && can("reopen") && <Button onClick={() => open("reopen")}><RotateCcw className="size-4" />Buka kembali</Button>}
      {!isFinalProject(status) && can("cancel") && <Button variant="danger" onClick={() => open("cancel")}><Ban className="size-4" />Batalkan proyek</Button>}
      <Dialog
        open={dlg !== null} onClose={() => !busy && setDlg(null)} size="sm"
        title={dlg === "cancel" ? "Batalkan proyek?" : "Buka kembali proyek?"}
        description={dlg === "cancel" ? "Proyek yang dibatalkan bersifat final dan datanya dikunci. Alasan dicatat di riwayat." : "Proyek kembali berstatus Berjalan dan catatan penutupan dihapus dari tampilan (tetap ada di riwayat). Alasan dicatat."}
        footer={<><Button onClick={() => setDlg(null)} disabled={busy}>Kembali</Button><Button variant={dlg === "cancel" ? "danger" : "primary"} loading={busy} disabled={reason.trim().length < 5} onClick={() => void submit()}>{dlg === "cancel" ? "Ya, batalkan" : "Ya, buka kembali"}</Button></>}
      >
        <div className="space-y-3">{error && <Notice tone="danger">{error}</Notice>}<TextAreaField label="Alasan" required rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} hint="Minimal 5 karakter." /></div>
      </Dialog>
    </>
  );
}
