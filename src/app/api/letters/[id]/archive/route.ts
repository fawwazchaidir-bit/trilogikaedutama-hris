import { route } from "@/server/http";
import { readUpload } from "@/server/upload";
import { uploadArchiveFile } from "@/server/services/letters/documents";
import { env } from "@/server/env";

/** Unggah PDF pindaian (tanda tangan basah) untuk surat arsip-saja yang sudah bernomor. Sekali pasang. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => {
  const { name, bytes } = await readUpload(req, "file", env().MAX_DOCUMENT_UPLOAD_MB);
  return uploadArchiveFile(actor, params.id, { name, bytes });
});
