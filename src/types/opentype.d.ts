/** Deklarasi minimal untuk opentype.js 2.x (paket tidak menyertakan tipe). Hanya yang dipakai pada cap foto absensi. */
declare module "opentype.js" {
  export interface Path { toPathData(decimalPlaces?: number): string }
  export interface Font {
    unitsPerEm: number;
    charToGlyphIndex(char: string): number;
    getAdvanceWidth(text: string, fontSize?: number): number;
    getPath(text: string, x: number, y: number, fontSize?: number): Path;
  }
  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
