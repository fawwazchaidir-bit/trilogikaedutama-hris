import { created, route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";
import { setLogo } from "@/server/services/settings";
import { transaction } from "@/server/db";

export const POST = route(async ({ req, actor }) => {
  assertCan(actor, "settings:manage"); // izin diperiksa SEBELUM badan unggahan dibaca ke memori
  const { name, bytes } = await readUpload(req);
  return created(await transaction(async (tx) => {
    const file = await storeFile(actor, "LOGO", { name, bytes }, tx);
    await setLogo(actor, file.id, tx);
    return file;
  }));
});
