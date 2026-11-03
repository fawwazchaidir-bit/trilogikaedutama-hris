import { created, route } from "@/server/http";
import { env } from "@/server/env";
import { readUpload } from "@/server/upload";
import { assertCanUploadDocument, listDocuments, uploadDocument } from "@/server/services/training/operations";

export const GET = route<{ id: string }>(async ({ actor, params }) => listDocuments(actor, params.id));

/** Unggah dokumen proyek (multipart: `file` + category/title/note). Izin & kunci proyek diperiksa SEBELUM badan dibaca ke memori. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => {
  await assertCanUploadDocument(actor, params.id);
  const { name, bytes, fields } = await readUpload(req, "file", env().MAX_DOCUMENT_UPLOAD_MB);
  return created(await uploadDocument(actor, params.id, { name, bytes }, fields));
});
