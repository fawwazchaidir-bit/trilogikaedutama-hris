import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { resetConfigured } from "@/server/services/password-reset";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <LoginForm canReset={resetConfigured()} />
    </div>
  );
}
