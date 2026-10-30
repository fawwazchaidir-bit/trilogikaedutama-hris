import { created, route } from "@/server/http";
import { readUpload } from "@/server/upload";
import { storeFile } from "@/server/services/files";

/** Unggah lampiran pendukung (PNG/JPG/PDF). Klien menyertakan `id` saat mengajukan. */
export const POST = route(async ({ req, actor }) => {
  const { name, bytes } = await readUpload(req);
  return created(await storeFile(actor, "LEAVE_ATTACHMENT", { name, bytes }));
});
