export default function Loading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="h-10 w-48 animate-pulse rounded-xl bg-ink-3" />
      <div className="h-40 animate-pulse rounded-3xl bg-ink-2" />
    </div>
  );
}
