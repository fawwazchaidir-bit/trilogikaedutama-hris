import { route } from "@/server/http";
import { readUpload } from "@/server/upload";
import { uploadDealEvidence } from "@/server/services/letters/commercial";
import { env } from "@/server/env";
/** Unggah bukti Deal (PO / persetujuan klien): PDF atau JPG. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => {
  const { name, bytes } = await readUpload(req, "file", env().MAX_DOCUMENT_UPLOAD_MB);
  return uploadDealEvidence(actor, params.id, { name, bytes });
});
