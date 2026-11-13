import Link from "next/link";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
      <Link href="/" className="display text-2xl italic">botmon</Link>
      <h1 className="display mt-10 text-4xl">Privacy</h1>
      <div className="mt-8 space-y-5 leading-relaxed text-muted">
        <p><strong className="text-paper">What we store.</strong> Your Google name, email and avatar; the people you add; the chats you upload; your AI keys; and the analyses generated.</p>
        <p><strong className="text-paper">How.</strong> Chats and API keys are encrypted with AES-256-GCM before being written to the database. Keys are never sent back to your browser.</p>
        <p><strong className="text-paper">Who sees your chats.</strong> Nobody at botmon reads them. When you run an analysis, the chat is sent to the AI provider whose key you added (Google, OpenAI or NVIDIA) under that provider&apos;s terms.</p>
        <p><strong className="text-paper">Consent.</strong> Only upload conversations you are part of. The other person&apos;s messages are personal data too; treat them with care.</p>
        <p><strong className="text-paper">Deleting.</strong> Deleting a person removes their chats and analyses. Deleting your account in Settings removes everything. You can export all your data from Settings.</p>
      </div>
    </main>
  );
}
