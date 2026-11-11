/** Dipanggil Next.js sekali saat server Node mulai: menyalakan pekerja latar (pengiriman notifikasi, retensi foto absensi, pengingat kontrak kerja, pekerja harian Training & Operations). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startDeliveryWorker } = await import("./server/notify/worker");
  startDeliveryWorker();
  const { startRetentionWorker } = await import("./server/retention-worker");
  startRetentionWorker();
  const { startContractWorker } = await import("./server/contract-worker");
  startContractWorker();
  const { startTrainingWorker } = await import("./server/training-worker");
  startTrainingWorker();
  const { startChecklistWorker } = await import("./server/checklist-worker");
  startChecklistWorker();
  const { startLettersWorker } = await import("./server/letters-worker");
  startLettersWorker();
  const { startChatWorker } = await import("./server/chat-worker");
  startChatWorker();
  // Kesiapan Persuratan dicatat di log (tidak menghentikan aplikasi): pembuatan surat tugas hanya lewat Persuratan, jadi konfigurasi yang kurang harus terlihat jelas.
  void import("./server/services/letters/readiness")
    .then(async ({ checkLettersReadiness }) => {
      const { formatReport } = await import("./lib/letters-readiness");
      const r = await checkLettersReadiness();
      if (r.errors > 0 || r.warnings > 0 || !r.canCreateAssignments) console.warn(`[surat] Kesiapan Persuratan:\n${formatReport({ ...r, checks: r.checks.filter((c) => c.severity !== "OK") })}`);
    })
    .catch((e) => console.error("[surat] pemeriksaan kesiapan gagal:", e instanceof Error ? e.message : e));
}
