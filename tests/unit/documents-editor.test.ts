import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { normalizeDoc, validateDoc } from "@/lib/documents/content";
import { documentExtensions } from "@/lib/documents/editor-extensions";
import { frameSk, frameSuratNarasumber, frameSuratPenawaran } from "../fixtures/documents/frames";

const schema = getSchema(documentExtensions);
const fixtures = { penawaran: frameSuratPenawaran, narasumber: frameSuratNarasumber, sk: frameSk };

describe("skema editor TipTap ⇄ model isi dokumen", () => {
  for (const [name, mk] of Object.entries(fixtures)) {
    it(`fixture ${name}: diterima skema editor, lolos validateDoc setelah round-trip`, async () => {
      const frame = await mk();
      const docs = [frame.body, ...(frame.attachments).map((a) => a.body)];
      for (const d of docs) {
        expect(validateDoc(d)).toBeNull();
        const node = schema.nodeFromJSON(d);
        node.check();
        const back = normalizeDoc(node.toJSON() as never);
        expect(validateDoc(back), JSON.stringify(back).slice(0, 200)).toBeNull();
        // round-trip kedua stabil
        expect(normalizeDoc(schema.nodeFromJSON(back).toJSON() as never)).toEqual(back);
        expect(back).toEqual(normalizeDoc(d)); // identik dengan fixture asli (kecuali default)
      }
    });
  }
  it("tidak menyediakan node/mark di luar daftar (link, code, blockquote…)", () => {
    for (const n of ["blockquote", "codeBlock", "horizontalRule", "image"]) expect(schema.nodes[n]).toBeUndefined();
    for (const m of ["link", "code", "strike"]) expect(schema.marks[m]).toBeUndefined();
  });
});
