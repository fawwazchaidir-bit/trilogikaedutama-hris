/** Dipanggil Next.js sekali saat server Node mulai: menyalakan pekerja latar (pengiriman notifikasi, retensi foto absensi, pengingat kontrak kerja). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDeliveryWorker } = await import("./server/notify/worker");
  startDeliveryWorker();
  const { startRetentionWorker } = await import("./server/retention-worker");
  startRetentionWorker();
  const { startContractWorker } = await import("./server/contract-worker");
  startContractWorker();
}
