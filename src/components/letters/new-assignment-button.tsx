"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import type { LetterTypeDto } from "@/server/services/letters/types";

/** Buat draf Surat Tugas (INT-002) lalu buka editornya. Penerbitan: penandatangan menyetujui di Persuratan. */
export function NewAssignmentButton() {
  const router = useRouter(); const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const types = await api<LetterTypeDto[]>("/api/letters/types");
      const t = types.find((x) => x.kind === "TUGAS");
      if (!t) throw new Error("Jenis Surat Tugas tidak tersedia.");
      const d = await api<{ id: string }>("/api/letters", { body: { typeId: t.id } });
      router.push(`/persuratan/${d.id}`);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return <Button variant="primary" loading={busy} onClick={() => void go()}><Plus className="size-4" />Buat Surat Tugas</Button>;
}
