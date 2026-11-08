"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateLong } from "@/lib/format";
import { KIND_LABEL } from "@/lib/employee-checklist";
import type { MyChecklistItemDto } from "@/server/services/employee-checklists";

/** Butir checklist yang menjadi tanggung jawab saya: tandai selesai (tercatat siapa & kapan). */
export function MyChecklistList({ items }: { items: MyChecklistItemDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function done(id: string) {
    setBusy(id);
    try { await api(`/api/employee-checklists/item/${id}`, { method: "PATCH", body: { status: "DONE", note: "" } }); toast.success("Butir ditandai selesai."); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.itemId} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{i.title}</p>
            <p className="text-xs text-muted">{i.employeeName} · {KIND_LABEL[i.kind]} · {i.group}{i.dueDate ? ` · tenggat ${formatDateLong(i.dueDate)}` : ""} {i.overdue && <Badge tone="red">Terlambat</Badge>}</p>
            {i.hint && <p className="mt-0.5 text-xs text-muted">{i.hint}</p>}
          </div>
          <Button size="sm" variant="primary" loading={busy === i.itemId} onClick={() => done(i.itemId)} aria-label={`Tandai selesai: ${i.title} (${i.employeeName})`}>Selesai</Button>
        </li>
      ))}
    </ul>
  );
}
