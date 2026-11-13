"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";

export function GoogleButton({ label = "Continue with Google" }: { label?: string }) {
  const [pending, setPending] = useState(false);

  async function signIn() {
    setPending(true);
    try {
      const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" });
      if (error) throw new Error(error.message);
    } catch (e) {
      toast.error((e as Error).message || "Google sign-in failed. Try again.");
      setPending(false);
    }
  }

  return (
    <button type="button" onClick={signIn} disabled={pending} className="btn-primary h-12 px-6 text-base">
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
        <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1a5.95 5.95 0 0 1 0-11.9c1.85 0 3.1.79 3.8 1.47l2.6-2.5C16.76 3.7 14.6 2.7 12 2.7a9.3 9.3 0 0 0 0 18.6c5.37 0 8.93-3.77 8.93-9.09 0-.61-.07-1.08-.16-1.55Z" />
      </svg>
      {pending ? "Opening Google…" : label}
    </button>
  );
}
