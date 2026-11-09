"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import type { ChatSubjectTypeValue } from "@/lib/chat/types";
import { useChat } from "./chat-provider";

/** Tombol "Diskusi": membuka (atau membuat) utas obrolan untuk satu penugasan, setelah server memastikan pengguna berhak melihat penugasan itu. Tidak tampil bila Obrolan mati. */
export function DiscussButton({ type, id, label = "Diskusi", className }: { type: ChatSubjectTypeValue; id: string; label?: string; className?: string }) {
  const { enabled } = useChat();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  async function open() {
    setBusy(true);
    try { const r = await api<{ id: string }>("/api/chat/subjects", { body: { type, id } }); router.push(`/obrolan?room=${r.id}`); }
    catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return <Button size="sm" loading={busy} onClick={() => void open()} className={className} aria-label={`${label} (obrolan penugasan)`}><MessagesSquare className="size-3.5" />{label}</Button>;
}
