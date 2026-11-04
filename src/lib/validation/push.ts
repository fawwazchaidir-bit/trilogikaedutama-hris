/** Validasi langganan Web Push dari peramban (`PushSubscription.toJSON()`). */
import { z } from "zod";
import { b64u, isAllowedPushEndpoint } from "@/lib/webpush";

const decodes = (min: number, max: number, first?: number) => (v: string): boolean => {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) return false;
  const b = b64u.dec(v);
  return b.length >= min && b.length <= max && (first === undefined || b[0] === first);
};

export const pushSubscribeSchema = z.object({
  endpoint: z.string().refine(isAllowedPushEndpoint, "Alamat layanan push tidak dikenali"),
  keys: z.object({
    /** Kunci publik P-256 peramban: 65 byte, berawalan 0x04. */
    p256dh: z.string().refine(decodes(65, 65, 0x04), "Kunci publik tidak sah"),
    /** Rahasia auth: 16 byte. */
    auth: z.string().refine(decodes(16, 16), "Rahasia auth tidak sah"),
  }),
});
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().min(20).max(600) });
