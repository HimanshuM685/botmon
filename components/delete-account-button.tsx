"use client";

import { deleteAccount } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";
import { signOutAndReload } from "./sign-out-button";

export function DeleteAccountButton() {
  return (
    <ConfirmButton
      action={deleteAccount}
      className="btn-danger"
      title="Delete your account?"
      description={<>Everything (people, chats, reads, coach conversations, timeline) is hidden right away and your AI keys are deleted. You&apos;ll be signed out. Sign in again within <strong className="text-paper">30 days</strong> to restore it all; after that it&apos;s permanently erased.</>}
      confirmLabel="Delete my account"
      onDone={() => signOutAndReload({ serverSignedOut: true })}
    >
      Delete account
    </ConfirmButton>
  );
}
