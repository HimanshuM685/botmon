import { KeyForm } from "@/components/key-form";

export const metadata = { title: "Connect AI" };

export default function Onboarding() {
  return (
    <div className="mx-auto max-w-xl">
      <p className="chip mb-5">Step 1 of 2</p>
      <h1 className="display text-4xl">Connect an AI.</h1>
      <p className="mt-3 leading-relaxed text-muted">
        botmon runs on your own AI key, so you stay in control of cost and data. The fastest option is a <strong className="text-paper">free Gemini key</strong>: open Google AI Studio, click <em>Create API key</em>, paste it here.
      </p>
      <p className="mt-3 text-sm text-dim">
        A Google AI Pro / Gemini app subscription can&apos;t be used by other apps. Google only allows API keys for that.
      </p>
      <div className="card mt-8 p-6 sm:p-8">
        <KeyForm next="/dashboard" />
      </div>
    </div>
  );
}
