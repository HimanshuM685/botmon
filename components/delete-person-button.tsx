"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deletePerson } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";

export function DeletePersonButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      action={() => deletePerson(id)}
      title={`Delete ${name}?`}
      description={<>{name}, with every chat, read, coach conversation and timeline item, moves to the trash. You can restore everything from <strong className="text-paper">Trash</strong> for 30 days.</>}
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
