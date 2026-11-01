import { created, route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";
import { setEmployeePhoto } from "@/server/services/employees";
import { transaction } from "@/server/db";

/** Unggah foto profil (PNG/JPG, diverifikasi dari isi file). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => {
  assertCan(actor, "employee:manage"); // izin diperiksa SEBELUM badan unggahan dibaca ke memori
  const { name, bytes } = await readUpload(req);
  return created(await transaction(async (tx) => {
    const file = await storeFile(actor, "EMPLOYEE_PHOTO", { name, bytes }, tx);
    await setEmployeePhoto(actor, params.id, file.id, tx);
    return file;
  }));
});
