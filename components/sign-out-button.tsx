"use client";

import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";

/**
 * Sign out through the Neon Auth client (clears the session and the cached session-data cookie),
 * then load "/" fresh so no cached signed-in page from the client router can come back.
 * Returns false (and toasts) if sign-out failed; the page stays put in that case.
 */
export async function signOutAndReload({ serverSignedOut = false } = {}): Promise<boolean> {
  const res = await authClient.signOut().catch((e: Error) => ({ error: e }));
  // When the server already ended the session (account deletion), a client-side failure only
  // leaves a short-lived cached cookie behind, so reload anyway.
  if (res?.error && !serverSignedOut) {
    toast.error("Couldn't sign out. Check your connection and try again.");
    return false;
  }
  window.location.replace("/");
  return true;
}

export function SignOutButton({ className = "text-sm text-muted hover:text-paper", children = "Sign out" }: { className?: string; children?: React.ReactNode }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button" className={className} disabled={pending}
      onClick={async () => {
        setPending(true);
        if (!(await signOutAndReload())) setPending(false);
      }}
    >
      {pending ? "Signing out…" : children}
    </button>
  );
}
