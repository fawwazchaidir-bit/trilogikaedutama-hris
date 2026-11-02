import { created, queryObject, route } from "@/server/http";
import { assertCan } from "@/server/actor";
import { env } from "@/server/env";
import { readUpload } from "@/server/upload";
import { createDocument, listDocuments } from "@/server/services/documents";

export const GET = route(async ({ req, actor }) => listDocuments(actor, queryObject(req)));

/** Unggah dokumen (multipart: `file` PDF + isian teks). Izin diperiksa SEBELUM badan unggahan dibaca ke memori. */
export const POST = route(async ({ req, actor }) => {
  assertCan(actor, "document:manage");
  const { name, bytes, fields } = await readUpload(req, "file", env().MAX_DOCUMENT_UPLOAD_MB);
  return created(await createDocument(actor, fields, { name, bytes }));
});
