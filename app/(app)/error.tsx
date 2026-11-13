"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card p-10 text-center">
      <h2 className="display text-3xl">Something broke.</h2>
      <p className="mt-2 text-muted">Your data is safe. Try again.</p>
      <button onClick={reset} className="btn-ghost mt-6">Retry</button>
    </div>
  );
}
