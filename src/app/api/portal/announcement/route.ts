import { readBody, route } from "@/server/http";
import { getBanner, listBannerHistory, resetBanner, setBanner } from "@/server/services/announcement";

/** GET: banner yang berlaku (semua pengguna masuk) + riwayat (hanya Direktur). PUT: pasang pesan. DELETE: kembali ke bawaan. Hanya Super Admin yang menulis. */
export const GET = route(async ({ actor }) => ({ banner: await getBanner(), history: actor.role === "SUPER_ADMIN" ? await listBannerHistory(actor) : [] }));
export const PUT = route(async ({ req, actor }) => setBanner(actor, await readBody(req)));
export const DELETE = route(async ({ actor }) => { await resetBanner(actor); return { ok: true }; });
