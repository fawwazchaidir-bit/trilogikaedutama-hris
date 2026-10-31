import type { Metadata } from "next";
import { inspectResetToken } from "@/server/services/password-reset";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Atur Ulang Password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const state = await inspectResetToken(token);
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <ResetForm token={token} valid={state.valid} needsTwoFactor={state.needsTwoFactor} />
    </div>
  );
}
