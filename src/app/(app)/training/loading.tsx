/** Tampilan memuat untuk seluruh halaman Training & Operations. */
export default function TrainingLoading() {
  return (
    <div role="status" aria-live="polite" aria-label="Memuat" className="animate-pulse space-y-4">
      <div className="h-7 w-64 rounded bg-stone-200" />
      <div className="h-4 w-96 max-w-full rounded bg-stone-200" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border border-line bg-surface" />)}</div>
      <div className="h-64 rounded-lg border border-line bg-surface" />
      <span className="sr-only">Memuat data…</span>
    </div>
  );
}
