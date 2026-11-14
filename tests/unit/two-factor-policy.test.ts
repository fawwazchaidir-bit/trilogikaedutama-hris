/** Aturan peran untuk kewajiban 2FA: hanya Super Admin (Direktur) dan HR; Karyawan (manajer, staf, magang) tidak pernah diwajibkan. */
import { describe, expect, it } from "vitest";
import { TWO_FACTOR_REQUIRED_ROLES, isTwoFactorRequiredRole, twoFactorRequired } from "@/lib/two-factor-policy";

describe("kebijakan wajib 2FA per peran", () => {
  it("peran yang diwajibkan: tepat Super Admin dan HR (ditulis eksplisit, bukan 'semua selain karyawan')", () => {
    expect([...TWO_FACTOR_REQUIRED_ROLES].sort()).toEqual(["HR_ADMIN", "SUPER_ADMIN"]);
    expect(isTwoFactorRequiredRole("SUPER_ADMIN")).toBe(true);
    expect(isTwoFactorRequiredRole("HR_ADMIN")).toBe(true);
  });
  it("Karyawan (termasuk manajer, supervisor, staf, magang — semuanya berperan EMPLOYEE) tidak diwajibkan; peran tak dikenal juga tidak otomatis wajib", () => {
    expect(isTwoFactorRequiredRole("EMPLOYEE")).toBe(false);
    for (const r of ["MANAGER", "STAFF", "INTERN", "FINANCE_ADMIN", "", "super_admin"]) expect(isTwoFactorRequiredRole(r), r).toBe(false);
  });
  it("wajib hanya bila kebijakan perusahaan menyala", () => {
    expect(twoFactorRequired("SUPER_ADMIN", true)).toBe(true);
    expect(twoFactorRequired("HR_ADMIN", true)).toBe(true);
    expect(twoFactorRequired("SUPER_ADMIN", false)).toBe(false);
    expect(twoFactorRequired("HR_ADMIN", false)).toBe(false);
    expect(twoFactorRequired("EMPLOYEE", true)).toBe(false);
    expect(twoFactorRequired("EMPLOYEE", false)).toBe(false);
  });
});
