import { created, readBody, route } from "@/server/http";
import { readUpload } from "@/server/upload";
import { addEditorAttachment, uploadAttachment } from "@/server/services/letters/attachments";
import { Errors } from "@/server/errors";
import { env } from "@/server/env";

/** Tambah lampiran: JSON `{title}` = lampiran editor; multipart (`file`, `title`, `mode`=MERGED|SEPARATE) = PDF unggahan buatan luar sistem. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => {
  if ((req.headers.get("content-type") ?? "").toLowerCase().includes("multipart/form-data")) {
    const { name, bytes, fields } = await readUpload(req, "file", env().MAX_DOCUMENT_UPLOAD_MB);
    const mode = fields.mode === "SEPARATE" ? "SEPARATE" : fields.mode === "MERGED" ? "MERGED" : null;
    if (!mode) throw Errors.validation("Pilih mode lampiran: MERGED atau SEPARATE.");
    return created(await uploadAttachment(actor, params.id, { title: fields.title ?? "", mode, name, bytes }));
  }
  return created(await addEditorAttachment(actor, params.id, await readBody(req)));
});
