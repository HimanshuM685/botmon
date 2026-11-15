"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { moveChat, removeChat } from "@/app/actions";
import { ConfirmButton } from "./confirm-button";

const item = "block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-ink-3";

/** For a chat saved to the wrong person: take it off this person, or hand it to the right one. */
export function ChatActions({ chatId, chatWith, personName, others }: { chatId: string; chatWith: string; personName: string; others: { id: string; name: string }[] }) {
  const router = useRouter();
  const fallout = "Reads made from it, and the timeline items those reads added, go to Trash for 30 days. If it replaced an earlier chat, that one comes back.";
  return (
    <details className="relative">
      <summary className="btn-ghost h-9 cursor-pointer list-none px-4 [&::-webkit-details-marker]:hidden">Wrong chat?</summary>
      <div className="absolute right-0 z-10 mt-2 w-60 rounded-2xl border border-line bg-ink-2 p-2 shadow-2xl">
        {others.map((p) => (
          <ConfirmButton
            key={p.id} className={item}
            action={() => moveChat(chatId, p.id)}
            title={`Move this chat to ${p.name}?`}
            description={<>The chat with {chatWith} moves from {personName} to {p.name}. {fallout} Any chat {p.name} has now goes to Trash.</>}
            confirmLabel="Move chat"
            onDone={() => {
              toast.success(`Chat moved to ${p.name}`);
              router.push(`/people/${p.id}`);
            }}
          >
            Move to {p.name}
          </ConfirmButton>
        ))}
        <ConfirmButton
          className={`${item} text-heart`}
          action={() => removeChat(chatId)}
          title="Remove this chat?"
          description={<>The chat with {chatWith} is taken off {personName} and goes to Trash. {fallout}</>}
          confirmLabel="Remove chat"
          onDone={() => { toast.success("Chat removed"); }}
        >
          Remove this chat
        </ConfirmButton>
      </div>
    </details>
  );
}
