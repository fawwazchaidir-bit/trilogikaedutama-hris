/**
 * Modul Training & Operations DIMATIKAN (TRAINING_MODULE_ENABLED=false — default aplikasi): seluruh layanan menjawab "tidak ditemukan"
 * bahkan untuk Manajer/Super Admin, dan fitur HRIS tetap berjalan normal. Berkas ini sengaja memaksa flag mati SEBELUM env dibaca.
 */
process.env.TRAINING_MODULE_ENABLED = "false";

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { trainingEnabled } from "@/server/env";
import { storeFile } from "@/server/services/files";
import { listOvertime } from "@/server/services/overtime";
import { resetDb } from "../helpers/db";
import { PDF, seedTraining, type TrainingFixtures } from "../helpers/training";
import { createProject, getProject, listProjects } from "@/server/services/training/projects";
import { getTrainingDashboard } from "@/server/services/training/insights";
import { getModuleContext, listAccessRows, setAccessLevel } from "@/server/services/training/access";
import { createTask } from "@/server/services/training/work";

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

describe("flag modul mati", () => {
  it("flag terbaca mati; setiap layanan menjawab NOT_FOUND untuk semua pelaku termasuk Manajer & Super Admin", async () => {
    expect(trainingEnabled()).toBe(false);
    for (const actor of [fx.mgr, fx.superAdmin, fx.viewer, fx.emp1]) {
      expect(await fail(listProjects(actor))).toMatchObject({ code: "NOT_FOUND" });
      expect(await fail(getTrainingDashboard(actor))).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await fail(createProject(fx.mgr, { name: "Tidak boleh" }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await fail(getProject(fx.mgr, "00000000-0000-4000-8000-000000000000"))).toMatchObject({ code: "NOT_FOUND" });
    expect(await fail(createTask(fx.mgr, "00000000-0000-4000-8000-000000000000", { title: "x1x" }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await fail(listAccessRows(fx.superAdmin))).toMatchObject({ code: "NOT_FOUND" });
    expect(await fail(setAccessLevel(fx.superAdmin, { userId: fx.loner.userId, level: "VIEWER" }))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("berkas dokumen proyek tidak dapat disimpan saat modul mati", async () => {
    expect(await fail(storeFile(fx.mgr, "TRAINING_DOCUMENT", { name: "a.pdf", bytes: PDF() }))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("data tidak dihapus & HRIS berjalan normal: level akses tetap tersimpan, fitur HRIS tetap dapat dipakai", async () => {
    expect(await prisma.trainingAccess.count()).toBe(3);
    expect((await getModuleContext(fx.mgr)).subject.level).toBe("MANAGER"); // konteks murni (menu memeriksa flag sendiri)
    expect((await listOvertime(fx.hr)).total).toBe(0); // fitur HRIS tidak terpengaruh
  });
});
