"use client";
import { useEffect } from "react";
import { ensureRegistered } from "@/lib/push-client";

/** Tanpa tampilan: setelah masuk, mendaftarkan ulang langganan push peramban ini bila pengguna sudah pernah mengaktifkannya di sini. */
export function PushAutoRegister({ email }: { email: string }) {
  useEffect(() => { void ensureRegistered(email).catch(() => undefined); }, [email]);
  return null;
}
