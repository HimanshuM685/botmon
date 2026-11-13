"use client";

import { useState } from "react";
import { PersonForm } from "./person-form";

type Person = { id: string; name: string; relation: string; gender: string; notes: string | null };

export function EditPerson({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn-ghost h-9 px-4" onClick={() => setOpen(true)}>Edit</button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4 backdrop-blur" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal aria-label={`Edit ${person.name}`} className="card w-full max-w-lg p-6 sm:p-8" onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            <h2 className="display mb-6 text-2xl">Edit {person.name}</h2>
            <PersonForm person={person} onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
