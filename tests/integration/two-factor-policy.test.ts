/**
 * Kewajiban 2FA hanya untuk Direktur (Super Admin) dan HR: Manajer/Staf/Magang tidak diwajibkan tetapi fitur tetap ada; migrasi menyalakan kebijakan pada instalasi yang sudah ada;
 * instalasi baru (seed produksi) menyalakannya sejak awal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createSession, validateSession } from "@/server/auth/session";
import { getAccount } from "@/server/services/account";
import { updateSecurityPolicy } from "@/server/services/settings";
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, getTwoFactorStatus } from "@/server/services/two-factor";
import { totpAt } from "@/lib/totp";
import { resetDb, seedFixtures, TEST_PASSWORD, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
beforeEach(async () => { await resetDb(); fx = await seedFixtures(); });

async function enable(actor: Fixtures["emp1"]) {
  const setup = await beginTwoFactorSetup(actor, { password: TEST_PASSWORD });
  await enableTwoFactor(actor, { code: totpAt(setup.secret, Date.now()) });
  return setup.secret;
}

describe("peran yang diwajibkan", () => {
  it("kebijakan menyala: Direktur dan HR wajib setup (sesi ditandai), Karyawan tidak — apa pun tingkat jabatannya", async () => {
    // Karyawan dengan tingkat jabatan Manajer, Supervisor, Staf, dan Magang: semuanya berperan EMPLOYEE.
    const levels = ["MANAGER", "SUPERVISOR", "STAFF"] as const;
    for (const [i, level] of levels.entries()) await prisma.employee.update({ where: { id: fx.empIds[i]! }, data: { jobLevel: level } });
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: true });
    const must = async (userId: string) => (await validateSession((await createSession(userId, null, null)).token))!.mustSetupTwoFactor;
    expect(await must(fx.superAdmin.userId)).toBe(true);
    expect(await must(fx.hr.userId)).toBe(true);
    for (const e of [fx.emp1, fx.emp2, fx.emp3]) expect(await must(e.userId), e.userId).toBe(false);
    for (const e of [fx.emp1, fx.emp2, fx.emp3]) expect((await getAccount(e)).twoFactor.required).toBe(false);
    expect((await getAccount(fx.hr)).twoFactor.required).toBe(true);
    expect((await getAccount(fx.superAdmin)).twoFactor.required).toBe(true);
  });

  it("kebijakan mati: tidak ada yang diwajibkan", async () => {
    const must = async (userId: string) => (await validateSession((await createSession(userId, null, null)).token))!.mustSetupTwoFactor;
    expect(await must(fx.superAdmin.userId)).toBe(false);
    expect(await must(fx.hr.userId)).toBe(false);
    expect((await getAccount(fx.hr)).twoFactor.required).toBe(false);
  });

  it("fitur tetap ada bagi yang tidak diwajibkan: Manajer/Staf dapat mengaktifkan DAN mematikan 2FA sendiri walau kebijakan menyala", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[0]! }, data: { jobLevel: "MANAGER" } });
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: true });
    for (const actor of [fx.emp1, fx.emp2]) {
      const secret = await enable(actor);
      expect((await getTwoFactorStatus(actor)).enabled).toBe(true);
      await prisma.user.update({ where: { id: actor.userId }, data: { twoFactorLastStep: Math.floor(Date.now() / 30_000) - 5 } });
      expect(await fail(disableTwoFactor(actor, { password: TEST_PASSWORD, code: totpAt(secret, Date.now() + 30_000) }))).toBeNull();
      expect((await getTwoFactorStatus(actor)).enabled).toBe(false);
    }
  });

  it("yang diwajibkan tidak dapat mematikan 2FA-nya selama kebijakan menyala (Direktur dan HR); setelah dicabut dapat", async () => {
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: true });
    for (const actor of [fx.hr, fx.superAdmin]) {
      const secret = await enable(actor);
      const e = await fail(disableTwoFactor(actor, { password: TEST_PASSWORD, code: totpAt(secret, Date.now() + 30_000) }));
      expect(e?.code, actor.userId).toBe("FORBIDDEN");
      expect(e?.message).toContain("Direktur dan HR");
      expect((await getTwoFactorStatus(actor)).enabled).toBe(true);
    }
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: false });
  });

  it("perubahan kebijakan tercatat di Audit Log dengan peran yang disebut jelas", async () => {
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: true });
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.security_policy_update" }, orderBy: { createdAt: "desc" } });
    expect(a.summary).toBe("2FA diwajibkan untuk Direktur dan HR");
  });
});

describe("bawaan kebijakan: instalasi yang sudah ada dan instalasi baru", () => {
  it("migrasi menyalakan kebijakan pada baris pengaturan yang sudah ada (dan tidak berpengaruh bila tidak ada baris)", async () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261114140000_two_factor_required_default/migration.sql"), "utf8");
    const statements = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((x) => x.trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
    await prisma.companySettings.update({ where: { id: 1 }, data: { twoFactorRequiredForAdmins: false } });
    await prisma.$executeRawUnsafe(statements[0]!);
    expect((await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } })).twoFactorRequiredForAdmins).toBe(true);
    await prisma.companySettings.deleteMany({});
    await expect(prisma.$executeRawUnsafe(statements[0]!)).resolves.toBe(0);                       // basis data kosong: tidak ada baris → tidak ada efek
  });

  it("seed produksi (instalasi baru) membuat pengaturan dengan 2FA wajib menyala", () => {
    const seed = readFileSync(join(process.cwd(), "prisma/seed.ts"), "utf8");
    expect(seed).toMatch(/companySettings\.upsert\([^;]*create:\s*\{[^}]*twoFactorRequiredForAdmins:\s*true/);
  });
});
