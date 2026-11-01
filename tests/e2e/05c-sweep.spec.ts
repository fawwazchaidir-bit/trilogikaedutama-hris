/**
 * Sapuan SELURUH rute API (ditemukan otomatis dari src/app/api) terhadap server produksi, untuk empat "pelaku":
 * anonim, Karyawan, HR, Super Admin. Yang dijaga:
 *   1. anonim → 401 di semua rute non-publik (tidak ada rute yang lupa otentikasi);
 *   2. tidak ada respons 5xx — masukan kosong/rusak/id ngawur/tipe konten salah/badan raksasa harus ditolak rapi (4xx);
 *   3. batas hak akses antar peran pada rute-rute penting (Karyawan ≠ admin, HR ≠ Super Admin);
 *   4. CSRF: permintaan pengubah tanpa Origin ditolak; 5. tidak ada detail internal (Prisma/stack) pada galat; header keamanan.
 * Berjalan sebelum 06-stage2 (yang mengaktifkan 2FA pada akun admin).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS } from "./helpers";

const API_DIR = path.join(process.cwd(), "src", "app", "api");
const UUID = "00000000-0000-4000-8000-000000000000";
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
interface Ep { url: string; route: string; method: Method }

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? walk(p) : n === "route.ts" ? [p] : []; });
}
function discover(): Ep[] {
  const eps: Ep[] = [];
  for (const file of walk(API_DIR)) {
    const rel = path.relative(path.join(process.cwd(), "src", "app"), path.dirname(file)).split(path.sep).join("/");
    const src = readFileSync(file, "utf8");
    const methods = [...src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1] as Method);
    const url = "/" + rel.replace(/\[[^\]]+\]/g, UUID);
    for (const method of methods) eps.push({ url, route: "/" + rel, method });
  }
  return eps.sort((a, b) => (a.route + a.method).localeCompare(b.route + b.method));
}
const ENDPOINTS = discover();

/** Rute yang sengaja terbuka tanpa sesi (login/pemulihan/health/pemicu mesin). */
const PUBLIC = new Set(["/api/health", "/api/auth/login", "/api/auth/2fa", "/api/auth/forgot", "/api/auth/reset", "/api/internal/deliveries", "/api/internal/retention"]);
/** Tidak disapu dengan `{}` karena `{}` SAH dan mengubah data / menutup sesi / mengirim pesan. */
const NO_EMPTY_BODY = new Set([
  "/api/attendance/check-in", "/api/attendance/check-out", "/api/auth/logout", "/api/auth/password", "/api/leave-balance/grant-quota",
  "/api/settings/payroll-rules/confirm", "/api/notifications/read", "/api/account/notifications/test", "/api/settings/deliveries",
]);

const withQuery = (e: Ep) => (e.route === "/api/reports/export" ? `${e.url}?kind=kehadiran&format=csv` : e.route === "/api/recap/detail" ? `${e.url}?employeeId=${UUID}` : e.url);
const SECRET_LEAK = /prisma|PrismaClient|\bat \S+ \(|\.tsx?:\d+|node_modules|ECONN|SELECT .* FROM|stack/i;

let base = "";
const ctxs: Record<"anon" | "employee" | "hr" | "admin", APIRequestContext> = {} as never;

async function session(email: string): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: base });
  const res = await c.post("/api/auth/login", { data: { email, password: E2E_PASSWORD }, headers: { origin: base } });
  expect(res.status(), `login ${email}`).toBe(200);
  expect((await res.json()).data.requiresTwoFactor).toBe(false);
  return c;
}
const send = (c: APIRequestContext, m: Method, url: string, opts: { body?: unknown; raw?: string; type?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = {};
  if (opts.origin !== null && m !== "GET") headers.origin = opts.origin ?? base;
  if (opts.type) headers["content-type"] = opts.type;
  return c.fetch(url, { method: m, headers, ...(opts.raw !== undefined ? { data: opts.raw } : opts.body !== undefined ? { data: opts.body } : {}), failOnStatusCode: false, maxRedirects: 0 });
};

test.beforeAll(async ({ baseURL }) => {
  base = new URL(baseURL!).origin;
  ctxs.anon = await pwRequest.newContext({ baseURL: base });
  ctxs.employee = await session(USERS.ayu);
  ctxs.hr = await session(USERS.hr);
  ctxs.admin = await session(USERS.pimpinan);
});
test.afterAll(async () => { for (const c of Object.values(ctxs)) await c.dispose(); });

test("rute ditemukan otomatis: jumlah wajar dan mencakup semua kelompok", () => {
  expect(ENDPOINTS.length).toBeGreaterThan(90);
  for (const prefix of ["/api/attendance", "/api/payroll", "/api/overtime", "/api/location", "/api/reports", "/api/account", "/api/users", "/api/settings", "/api/files"]) {
    expect(ENDPOINTS.some((e) => e.route.startsWith(prefix)), prefix).toBe(true);
  }
});

test("anonim: SEMUA rute non-publik menjawab 401 (tidak ada rute tanpa otentikasi)", async () => {
  const bad: string[] = [];
  for (const e of ENDPOINTS.filter((x) => !PUBLIC.has(x.route))) {
    const r = await send(ctxs.anon, e.method, withQuery(e), e.method === "GET" || e.method === "DELETE" ? {} : { body: {} });
    if (r.status() !== 401) bad.push(`${e.method} ${e.route} → ${r.status()}`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

test("rute publik: health 200; login/forgot/reset/2fa menolak masukan kosong dengan 4xx; pemicu mesin 404 tanpa CRON_SECRET", async () => {
  expect((await send(ctxs.anon, "GET", "/api/health")).status()).toBe(200);
  for (const u of ["/api/auth/login", "/api/auth/2fa", "/api/auth/forgot", "/api/auth/reset"]) {
    const r = await send(ctxs.anon, "POST", u, { body: {} });
    expect(r.status(), u).toBeGreaterThanOrEqual(400);
    expect(r.status(), u).toBeLessThan(500);
  }
  for (const u of ["/api/internal/deliveries", "/api/internal/retention"]) {
    expect((await send(ctxs.anon, "POST", u, { body: {}, origin: null })).status(), u).toBe(404);
  }
});

for (const role of ["employee", "hr", "admin"] as const) {
  test(`${role}: tidak ada respons 5xx pada GET (tanpa id / id UUID kosong / id ngawur), masukan kosong, JSON rusak, tipe konten salah`, async () => {
    const c = ctxs[role];
    const fail: string[] = [];
    const check = async (label: string, p: Promise<import("@playwright/test").APIResponse>) => {
      const r = await p;
      const body = r.status() >= 400 ? await r.text() : "";
      if (r.status() >= 500) fail.push(`${label} → ${r.status()} ${body.slice(0, 120)}`);
      else if (r.status() >= 400 && SECRET_LEAK.test(body)) fail.push(`${label} → bocoran detail internal: ${body.slice(0, 160)}`);
    };
    for (const e of ENDPOINTS.filter((x) => x.route !== "/api/auth/logout")) {
      const tag = `${role} ${e.method} ${e.route}`;
      if (e.method === "GET") {
        await check(`${tag} (uuid)`, send(c, "GET", withQuery(e)));
        await check(`${tag} (id ngawur)`, send(c, "GET", withQuery({ ...e, url: e.url.replace(UUID, "bukan-uuid") })));
        continue;
      }
      if (PUBLIC.has(e.route) || NO_EMPTY_BODY.has(e.route)) continue;
      await check(`${tag} ({})`, send(c, e.method, e.url, { body: {} }));
      await check(`${tag} (id ngawur)`, send(c, e.method, e.url.replace(UUID, "bukan-uuid"), { body: {} }));
      await check(`${tag} (JSON rusak)`, send(c, e.method, e.url, { raw: "{bukan json", type: "application/json" }));
      await check(`${tag} (text/plain)`, send(c, e.method, e.url, { raw: "halo", type: "text/plain" }));
      await check(`${tag} (array/null)`, send(c, e.method, e.url, { raw: "null", type: "application/json" }));
    }
    expect(fail, fail.join("\n")).toEqual([]);
  });
}

test("CSRF: permintaan pengubah tanpa Origin / dengan Origin asing ditolak 403 (sesi sah sekalipun) — di semua rute pengubah", async () => {
  const bad: string[] = [];
  for (const e of ENDPOINTS.filter((x) => x.method !== "GET" && !PUBLIC.has(x.route) && x.route !== "/api/auth/logout")) {
    const none = await send(ctxs.admin, e.method, e.url, { body: {}, origin: null });
    if (none.status() !== 403) bad.push(`${e.method} ${e.route} tanpa Origin → ${none.status()}`);
    const evil = await send(ctxs.admin, e.method, e.url, { body: {}, origin: "https://jahat.example" });
    if (evil.status() !== 403) bad.push(`${e.method} ${e.route} Origin asing → ${evil.status()}`);
  }
  expect(bad, bad.join("\n")).toEqual([]);
});

test("batas hak akses: Karyawan ditolak di rute admin; HR ditolak di rute khusus Super Admin; Super Admin diterima", async () => {
  const EMPLOYEE_DENIED: [Method, string][] = [
    ["GET", "/api/employees"], ["GET", "/api/employees/export"], ["GET", "/api/payroll"], ["GET", "/api/audit-logs"], ["GET", "/api/users"], ["GET", "/api/leaves"],
    ["GET", "/api/schedules"], ["GET", "/api/schedule-assignments"], ["GET", "/api/settings"], ["GET", "/api/settings/deliveries"], ["GET", "/api/recap"], ["GET", "/api/recap/export"],
    ["GET", "/api/reports/export?kind=kehadiran&format=csv"], ["GET", "/api/location"], ["GET", "/api/overtime"], ["GET", "/api/components"],
    ["POST", "/api/payroll"], ["POST", "/api/employees"], ["POST", "/api/users"], ["PUT", "/api/settings/attendance"], ["PUT", "/api/settings/security"], ["PUT", "/api/settings/statutory"],
    ["POST", `/api/payroll/${UUID}/approve`], ["POST", `/api/users/${UUID}/reset-2fa`], ["POST", `/api/location/${UUID}/review`], ["POST", `/api/overtime/${UUID}/review`], ["POST", `/api/leaves/${UUID}/review`],
    ["POST", "/api/attendance/correct"],
  ];
  const HR_DENIED: [Method, string][] = [
    ["GET", "/api/audit-logs"], ["PUT", "/api/settings/attendance"], ["PUT", "/api/settings/payroll-rules"], ["PUT", "/api/settings/statutory"], ["PUT", "/api/settings/security"],
    ["POST", "/api/settings/payroll-rules/confirm"], ["POST", `/api/payroll/${UUID}/approve`], ["POST", `/api/users/${UUID}/reset-2fa`], ["POST", "/api/settings/logo"],
  ];
  const known = new Set(ENDPOINTS.map((e) => `${e.method} ${e.route.replace(/\[[^\]]+\]/g, UUID)}`));
  const bad: string[] = [];
  const run = async (c: APIRequestContext, role: string, list: [Method, string][], allowed: number[]) => {
    for (const [m, u] of list) {
      const pathOnly = u.split("?")[0]!;
      if (!known.has(`${m} ${pathOnly}`)) { bad.push(`rute tidak ada (tes usang?): ${m} ${pathOnly}`); continue; }
      const r = await send(c, m, u, m === "GET" ? {} : { body: {} });
      if (!allowed.includes(r.status())) bad.push(`${role} ${m} ${u} → ${r.status()} (diharapkan ${allowed.join("/")})`);
    }
  };
  await run(ctxs.employee, "Karyawan", EMPLOYEE_DENIED, [403, 404]);
  await run(ctxs.hr, "HR", HR_DENIED, [403]);
  expect(bad, bad.join("\n")).toEqual([]);
  // Super Admin boleh membaca rute-rute itu.
  for (const u of ["/api/employees", "/api/payroll", "/api/audit-logs", "/api/users", "/api/settings", "/api/recap", "/api/location", "/api/overtime", "/api/reports/export?kind=kehadiran&format=csv"]) {
    expect((await send(ctxs.admin, "GET", u)).status(), `Super Admin GET ${u}`).toBe(200);
  }
});

test("batas masukan: badan JSON > 1 MB ditolak rapi (4xx, bukan 5xx/timeout); metode tak didukung → 405; unggahan salah tipe → 4xx", async () => {
  const huge = JSON.stringify({ name: "x".repeat(1_200_000) });
  const r = await send(ctxs.admin, "POST", "/api/employees", { raw: huge, type: "application/json" });
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(r.status()).toBeLessThan(500);
  expect((await send(ctxs.admin, "DELETE", "/api/employees")).status()).toBe(405);
  expect((await send(ctxs.admin, "PUT", "/api/payroll")).status()).toBe(405);
  // multipart ke rute JSON & JSON ke rute multipart
  const mp = await ctxs.admin.post("/api/employees", { multipart: { a: "b" }, headers: { origin: base }, failOnStatusCode: false });
  expect(mp.status()).toBeLessThan(500);
  const j = await send(ctxs.admin, "POST", `/api/employees/${UUID}/photo`, { body: {} });
  expect([400, 404, 422]).toContain(j.status());
});

test("header keamanan & cookie: CSP, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy; sesi HttpOnly + SameSite", async () => {
  const page = await ctxs.anon.get("/login");
  const h = page.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["permissions-policy"]).toBe("camera=(self), microphone=(), geolocation=(self)");
  expect(h["x-powered-by"]).toBeUndefined();
  const api = await ctxs.admin.get("/api/me");
  expect(api.headers()["content-security-policy"]).toBeTruthy();
  expect(api.headers()["cache-control"] ?? "").toMatch(/no-store|private|no-cache/);

  const fresh = await pwRequest.newContext({ baseURL: base });
  const login = await fresh.post("/api/auth/login", { data: { email: USERS.budi, password: E2E_PASSWORD }, headers: { origin: base } });
  const cookie = login.headersArray().filter((x) => x.name.toLowerCase() === "set-cookie").map((x) => x.value).join("\n");
  expect(cookie).toMatch(/hris_session=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).not.toMatch(/Expires=.*1970/);
  await fresh.dispose();
});

test("jawaban galat seragam: JSON {error:{code,message}}; 401 tanpa membocorkan apakah rute ada; 404 halaman API tak dikenal rapi", async () => {
  const r = await send(ctxs.anon, "GET", "/api/employees");
  const j = await r.json();
  expect(j.error.code).toBe("UNAUTHENTICATED");
  expect(typeof j.error.message).toBe("string");
  const nf = await send(ctxs.admin, "GET", `/api/employees/${UUID}`);
  expect(nf.status()).toBe(404);
  expect((await nf.json()).error.code).toBe("NOT_FOUND");
  const unknown = await send(ctxs.admin, "GET", "/api/tidak-ada-rute-ini");
  expect(unknown.status()).toBe(404);
  expect(await unknown.text()).not.toMatch(SECRET_LEAK);
});
