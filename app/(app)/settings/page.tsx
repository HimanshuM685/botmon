import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { PROVIDERS } from "@/lib/ai/models";
import { deleteAccount, deleteKey, setDefaultProvider } from "@/app/actions";
import { KeyForm } from "@/components/key-form";
import { ConfirmButton } from "@/components/confirm-button";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const user = await requireUser();
  const [keys, me] = await Promise.all([
    db.apiKey.findMany({ where: { userId: user.id }, select: { provider: true, model: true, last4: true }, orderBy: { createdAt: "asc" } }),
    db.user.findUnique({ where: { id: user.id }, select: { defaultProvider: true } }),
  ]);
  const active = me?.defaultProvider ?? keys[0]?.provider;

  return (
    <div className="space-y-10">
      <h1 className="display text-4xl">Settings</h1>

      <section className="space-y-4">
        <h2 className="display text-2xl">AI keys</h2>
        <p className="text-sm text-dim">Removing a key deletes it immediately (keys are secrets, so they never sit in the trash).</p>
        {keys.length > 0 && (
          <ul className="card divide-y divide-line">
            {keys.map((k) => (
              <li key={k.provider} className="flex flex-wrap items-center gap-3 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {PROVIDERS[k.provider].label}
                    {k.provider === active && <span className="chip ml-2 border-mint/40 text-mint">In use</span>}
                  </p>
                  <p className="font-mono text-xs text-dim">{k.model} · ••••{k.last4}</p>
                </div>
                {k.provider !== active && (
                  <form action={setDefaultProvider.bind(null, k.provider)}>
                    <button className="btn-ghost h-9 px-4">Use this</button>
                  </form>
                )}
                <form action={deleteKey.bind(null, k.provider)}>
                  <button className="btn-danger h-9 px-4">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="card p-6 sm:p-8">
          <h3 className="mb-5 font-medium">{keys.length ? "Add or replace a key" : "Add a key"}</h3>
          <KeyForm />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="display text-2xl">Your data</h2>
        <div className="card flex flex-wrap items-center gap-4 p-6">
          <p className="flex-1 text-sm text-muted">Download every person, chat and analysis as JSON.</p>
          <a href="/api/export" className="btn-ghost">Export data</a>
        </div>
        <div className="card flex flex-wrap items-center gap-4 border-heart/30 p-6">
          <p className="flex-1 text-sm text-muted">Delete your account and everything in it. You have 30 days to change your mind (sign in and restore); after that it&apos;s erased for good.</p>
          <ConfirmButton action={deleteAccount} confirm="Delete your account? Everything is hidden now and permanently erased after 30 days unless you sign in and restore it.">Delete account</ConfirmButton>
        </div>
      </section>
    </div>
  );
}
