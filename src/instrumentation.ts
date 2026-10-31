/** Dipanggil Next.js sekali saat server Node mulai: menyalakan pekerja pengiriman notifikasi (email/WhatsApp). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDeliveryWorker } = await import("./server/notify/worker");
  startDeliveryWorker();
}
