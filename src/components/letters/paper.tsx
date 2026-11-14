"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Lebar kertas A4 (21 cm) dalam piksel CSS. */
const PAPER_PX = (21 / 2.54) * 96;

/**
 * Kertas editor dengan lebar TETAP 21 cm (isi 17 cm = area isi PDF), diskalakan ke bawah (`zoom`) bila kolom editor lebih sempit. Dengan begitu pemenggalan baris di editor sama
 * dengan PDF pada lebar layar berapa pun — kertas yang menyempit mengikuti kolom TIDAK akan membungkus baris secara berbeda dari hasil PDF. Skala tidak pernah lebih dari 100%
 * dan tidak kurang dari 50% (di bawah itu kertas digulir ke samping agar tetap terbaca).
 */
export function Paper({ layout, children }: { layout: "default" | "edaran"; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => { const w = el.clientWidth; if (w > 0) setZoom(Math.max(0.5, Math.min(1, w / PAPER_PX))); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="w-full">
      <article data-layout={layout} data-zoom={zoom.toFixed(3)} className="letter-paper mx-auto bg-white px-[2cm] py-[1.5cm] shadow-md ring-1 ring-black/5" style={{ width: "21cm", minWidth: "21cm", zoom }}>
        {children}
      </article>
    </div>
  );
}
