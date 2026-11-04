import "server-only";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { requireModule } from "@/server/services/training/access";

/** Halaman Training & Operations: pengguna login + modul aktif + punya akses modul; selain itu 404 (keberadaan tidak bocor). */
export async function trainingPage() {
  const user = await requirePageUser();
  const ctx = await guard(() => requireModule(user));
  return { user, ctx };
}

/** Jalankan pemuatan data; AppError "tidak ada / tidak berhak / tidak valid" → 404. Galat lain dilempar (ditangkap error.tsx). */
export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN" || e.code === "VALIDATION")) notFound();
    throw e;
  }
}
