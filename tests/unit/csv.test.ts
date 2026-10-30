import { describe, expect, it } from "vitest";
import { parseCsv, detectDelimiter } from "@/lib/csv";

describe("parseCsv", () => {
  it("koma, kutip, kutip ganda di dalam kutip, dan baris baru di dalam kutip", () => {
    const rows = parseCsv('a,b,c\r\n1,"halo, dunia","ia berkata ""ya"""\r\n2,"baris\nbaru",x\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["1", "halo, dunia", 'ia berkata "ya"'], ["2", "baris\nbaru", "x"]]);
  });
  it("mendeteksi titik koma (Excel Indonesia) dan tab", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(detectDelimiter("satu")).toBe(",");
  });
  it("BOM dibuang, baris kosong dilewati, sel kosong dipertahankan", () => {
    expect(parseCsv("﻿a,b\n\n1,\n")).toEqual([["a", "b"], ["1", ""]]);
  });
});
