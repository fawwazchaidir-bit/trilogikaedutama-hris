"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

/**
 * Pola bersama form/aksi: jalankan panggilan API → tampilkan toast → segarkan data halaman server (router.refresh).
 * Galat ditampilkan dengan pesan dari server (Bahasa Indonesia) dan galat per-field bila ada.
 */
export function useRunner() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function run<T>(fn: () => Promise<T>, ok?: string, done?: (r: T) => void): Promise<boolean> {
    setBusy(true); setError(null); setFieldErrors({});
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      done?.(r);
      router.refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiClientError) setFieldErrors(e.fieldErrors);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const reset = () => { setError(null); setFieldErrors({}); };
  return { busy, error, fieldErrors, run, reset, router, toast };
}
