import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth/server";
import { GoogleButton } from "@/components/google-button";

// Session is read from cookies on every request.
export const dynamic = "force-dynamic";

const steps = [
  { n: "01", t: "Add your person", d: "Crush, girlfriend, favorite. Up to three people, each with their own space." },
  { n: "02", t: "Drop the chat", d: "Export from WhatsApp or Instagram and drop the file. Parsing happens in your browser." },
  { n: "03", t: "Get the read", d: "Where things stand, what they love, what to avoid, and the exact next move." },
];

export default async function Landing() {
  if (await getUserId()) redirect("/dashboard");

  return (
    <main className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[640px] rounded-full bg-heart/15 blur-[140px]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <span className="display text-2xl italic">botmon</span>
        <Link href="/privacy" className="text-sm text-muted hover:text-paper">Privacy</Link>
      </header>

      <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-10 sm:px-8 lg:grid-cols-[1.1fr_.9fr] lg:pt-20">
        <div className="rise">
          <p className="chip mb-6"><span className="size-1.5 rounded-full bg-heart" /> WhatsApp &amp; Instagram chats</p>
          <h1 className="display text-5xl leading-[1.02] sm:text-7xl">
            Stop guessing.<br />
            <em className="text-heart">Read the room.</em>
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
            Upload your chat with the person you care about. Get an honest read on where things stand, what they like, and what to do next.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <GoogleButton label="Start with Google" />
            <span className="text-sm text-dim">Free. Uses your own AI key.</span>
          </div>
        </div>

        <div className="rise relative mx-auto w-full max-w-sm [animation-delay:.15s]" aria-hidden>
          <div className="card space-y-3 p-5 shadow-2xl shadow-heart/5">
            <Bubble side="them">haha you remembered that??</Bubble>
            <Bubble side="me">obviously. you said it was your fav</Bubble>
            <Bubble side="them">okay that&apos;s actually so cute 🥹</Bubble>
          </div>
          <div className="card -mt-4 ml-8 p-5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wider text-muted">Status</span>
              <span className="display text-3xl text-heart">82</span>
            </div>
            <p className="display mt-1 text-xl italic">Clearly into you</p>
            <p className="mt-3 text-sm text-muted">
              <span className="text-mint">Next move:</span> suggest the café she mentioned, this weekend.
            </p>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <div className="grid gap-px overflow-hidden rounded-3xl border border-line bg-line md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="bg-ink p-8">
              <span className="font-mono text-xs text-heart">{s.n}</span>
              <h3 className="display mt-4 text-2xl">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-28 sm:px-8 md:grid-cols-2">
        <div>
          <h2 className="display text-4xl">Private by design.</h2>
          <p className="mt-4 max-w-md leading-relaxed text-muted">
            Chats and keys are encrypted with AES-256 before they touch the database. Your AI key talks to your provider directly from our server, never shared. Delete a person or your whole account any time and it&apos;s gone.
          </p>
        </div>
        <ul className="space-y-3 text-sm">
          {["Bring your own key: Gemini (free), OpenAI or NVIDIA NIM", "Advice that respects boundaries. No manipulation tricks.", "Export or delete everything in one click"].map((t) => (
            <li key={t} className="card flex items-center gap-3 px-5 py-4">
              <span className="size-2 shrink-0 rounded-full bg-mint" />
              {t}
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl justify-between px-5 py-6 text-xs text-dim sm:px-8">
          <span>© {new Date().getFullYear()} botmon</span>
          <Link href="/privacy" className="hover:text-paper">Privacy</Link>
        </div>
      </footer>
    </main>
  );
}

function Bubble({ side, children }: { side: "me" | "them"; children: React.ReactNode }) {
  return (
    <div className={side === "me" ? "flex justify-end" : "flex"}>
      <p className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${side === "me" ? "rounded-br-md bg-heart text-ink" : "rounded-bl-md bg-ink-3"}`}>
        {children}
      </p>
    </div>
  );
}
