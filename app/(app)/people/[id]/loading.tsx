// Shown under the person header and tabs the moment a tab is clicked, while the tab's data loads.
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-24 animate-pulse rounded-3xl bg-ink-2" />
      <div className="h-64 animate-pulse rounded-3xl bg-ink-2" />
    </div>
  );
}
