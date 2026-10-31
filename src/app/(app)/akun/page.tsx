import type { Metadata } from "next";
import { requirePageUser } from "@/server/auth/current";
import { getAccount } from "@/server/services/account";
import { PageHeader } from "@/components/ui/card";
import { NotificationPrefsCard, PasswordCard, TwoFactorCard } from "@/components/account-panel";

export const metadata: Metadata = { title: "Keamanan & Notifikasi" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  // allowSetup: halaman ini tetap dapat dibuka saat 2FA wajib tetapi belum aktif (justru di sinilah 2FA diaktifkan).
  const user = await requirePageUser({ allowSetup: true });
  const account = await getAccount(user);
  return (
    <div className="space-y-4">
      <PageHeader title="Keamanan & Notifikasi" description={`${account.name} · ${account.email}`} />
      <TwoFactorCard account={account} forced={user.mustSetupTwoFactor} />
      <NotificationPrefsCard account={account} />
      <PasswordCard />
    </div>
  );
}
