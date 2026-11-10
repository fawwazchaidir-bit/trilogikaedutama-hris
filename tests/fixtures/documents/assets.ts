import sharp from "sharp";
import type { DocImage } from "@/lib/documents/frame";

/** Gambar PLACEHOLDER (bukan logo/cap/tanda tangan asli) untuk fixture dan uji — dibuat dari SVG. */
const png = async (svg: string): Promise<DocImage> => ({ data: await sharp(Buffer.from(svg)).png().toBuffer(), mimeType: "image/png" });

export const demoLogo = () => png(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="140" fill="none" stroke="#e03131" stroke-width="14"/><text x="150" y="190" font-size="120" font-family="serif" font-style="italic" text-anchor="middle" fill="#e03131" font-weight="bold">tsf</text><text x="150" y="70" font-size="26" font-family="sans-serif" text-anchor="middle" fill="#e03131">DEMO</text></svg>`);
export const demoStamp = () => png(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="140" fill="none" stroke="#c0262d" stroke-width="8" opacity="0.85"/><circle cx="150" cy="150" r="118" fill="none" stroke="#c0262d" stroke-width="3" opacity="0.85"/><text x="150" y="165" font-size="44" font-family="serif" text-anchor="middle" fill="#c0262d" font-weight="bold" opacity="0.85">CAP DEMO</text></svg>`);
export const demoSignature = () => png(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220"><path d="M20 160 C 60 40, 90 40, 100 120 S 150 200, 190 90 S 250 20, 270 130 S 330 170, 380 60" fill="none" stroke="#1d3557" stroke-width="7" stroke-linecap="round"/><path d="M40 190 L 360 175" fill="none" stroke="#1d3557" stroke-width="4"/></svg>`);
