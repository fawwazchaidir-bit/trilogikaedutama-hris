import { getSchema } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { normalizeDoc, validateDoc } from "@/lib/documents/content";
import { documentExtensions } from "@/lib/documents/editor-extensions";
import { buildAssignmentBody } from "@/lib/documents/assignment-body";
import { doc, p } from "@/lib/documents/builders";
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
  it("isi yang dibangkitkan (Surat Tugas) & paragraf kosong diterima skema editor (tanpa node teks kosong)", () => {
    const body = buildAssignmentBody({ purpose: "Pendampingan", destination: "Bandung", startDate: "2026-11-10", endDate: "2026-11-12", details: "Uraian", assignees: [{ employeeId: "e1", dailyRate: 1, days: null }] },
      [{ employeeId: "e1", name: "Ayu", employeeNo: "A-1", position: "Staf", division: null }]);
    expect(validateDoc(body)).toBeNull();
    schema.nodeFromJSON(body).check();
    const empty = doc(p(""));
    schema.nodeFromJSON(empty).check();
    expect(JSON.stringify(empty)).not.toContain('"text":""');
  });
});
