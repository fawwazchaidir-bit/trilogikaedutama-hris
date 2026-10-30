/**
 * Parser CSV (RFC 4180): kutip ganda, kutip di dalam kutip (""), baris baru di dalam kutip, BOM UTF-8.
 * Pemisah dideteksi otomatis dari baris pertama (koma, titik koma — default Excel Indonesia —, atau tab).
 */
export function detectDelimiter(firstLine: string): string {
  const count = (c: string) => firstLine.split(c).length - 1;
  const candidates: [string, number][] = [[",", count(",")], [";", count(";")], ["\t", count("\t")]];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]![1] > 0 ? candidates[0]![0] : ",";
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const delim = detectDelimiter(text.split(/\r\n|\n|\r/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
