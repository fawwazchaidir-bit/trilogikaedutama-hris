import type { Metadata } from "next";
import { requirePageUser } from "@/server/auth/current";
import { listUsers } from "@/server/services/users";
import { listEmployeeOptions } from "@/server/services/employees";
import { PageHeader } from "@/components/ui/card";
import { UsersManager } from "@/components/users-manager";
import { manageableRoles } from "@/lib/permissions";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Akun Pengguna" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePageUser();
  const roles = manageableRoles(user.role);
  if (roles.length === 0) notFound();
  const [items, emps] = await Promise.all([listUsers(user), listEmployeeOptions(user)]);
  return (
    <div>
      <PageHeader title="Akun Pengguna" description="Kelola akun login. Kata sandi disimpan sebagai hash (scrypt) dan tidak dapat dilihat siapa pun." />
      <UsersManager items={items} selfId={user.userId} roles={roles} freeEmployees={emps.filter((e) => !e.userId).map((e) => ({ id: e.id, label: `${e.fullName} (${e.employeeNo})` }))} />
    </div>
  );
}
