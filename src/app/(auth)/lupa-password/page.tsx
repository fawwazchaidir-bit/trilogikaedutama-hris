import type { Metadata } from "next";
import { resetConfigured } from "@/server/services/password-reset";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Lupa Password" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <ForgotForm enabled={resetConfigured()} />
    </div>
  );
}
