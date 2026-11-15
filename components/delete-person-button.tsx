"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePerson } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";

export function DeletePersonButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [forgetMe, setForgetMe] = useState(false);
  return (
    <ConfirmButton
      action={() => deletePerson(id, { forgetMe })}
      title={`Delete ${name}?`}
      description={
        <>
          {name}, with every chat, read, coach conversation and timeline item, moves to the trash. You can restore everything from <strong className="text-paper">Trash</strong> for 30 days.
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={forgetMe} onChange={(e) => setForgetMe(e.target.checked)} />
            <span>Also forget what this chat taught about me. Your profile keeps only what other chats and you yourself showed; restoring {name} won&apos;t bring this back.</span>
          </label>
        </>
      }
      confirmLabel="Move to trash"
      onDone={() => {
        toast.success(`${name} moved to trash`);
        router.replace("/dashboard");
      }}
    >
      Delete
    </ConfirmButton>
  );
}
