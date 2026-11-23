import Link from "next/link";

export const metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 sm:px-8">
      <Link href="/" className="display text-2xl italic">botmon</Link>
      <h1 className="display mt-10 text-4xl">Privacy</h1>
      <div className="mt-8 space-y-5 leading-relaxed text-muted">
        <p><strong className="text-paper">What we store.</strong> Your Google name, email and avatar; the people you add; the chats you upload; your AI keys; and the analyses generated.</p>
        <p><strong className="text-paper">How.</strong> Chats and API keys are encrypted with AES-256-GCM before being written to the database. Keys are never sent back to your browser. To find small details in long chats, each stretch of a chat is also stored as keyed hashes of its words (searchable, not readable) and, when your AI key can make them, as an embedding: a list of numbers describing its meaning, made with your own key.</p>
        <p><strong className="text-paper">Who sees your chats.</strong> Nobody at botmon reads them. When you run a read or talk to the coach, the chat, your timeline and your coach messages are sent to the AI provider whose key you added (Google, OpenAI, xAI, Groq or NVIDIA) under that provider&apos;s terms.</p>
        <p><strong className="text-paper">Consent.</strong> Only upload conversations you are part of. The other person&apos;s messages are personal data too; treat them with care.</p>
        <p><strong className="text-paper">Deleting.</strong> Anything you delete (a person, a chat, a read, a coach conversation, a timeline item, or your whole account) is hidden immediately and kept in the trash for 30 days so you can restore it. After 30 days it is permanently erased, including your sign-in identity for a deleted account. AI keys are deleted immediately. You can export all your data, including coach conversations and the timeline, from Settings.</p>
      </div>
    </main>
  );
}
