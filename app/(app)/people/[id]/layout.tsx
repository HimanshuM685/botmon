import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getPerson } from "@/lib/data";
import { RELATIONS } from "@/lib/labels";
import { deletePerson } from "@/app/actions";
import { ConfirmButton } from "@/components/confirm-button";
import { EditPerson } from "@/components/edit-person";
import { PersonTabs } from "@/components/person-tabs";

export default async function PersonLayout({ children, params }: LayoutProps<"/people/[id]">) {
  const user = await requireUser();
  const person = await getPerson(user.id, (await params).id);
  if (!person) notFound();

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <span className="chip">{RELATIONS[person.relation]}</span>
          <h1 className="display mt-3 text-5xl">{person.name}</h1>
        </div>
        <EditPerson person={person} />
        <ConfirmButton
          action={deletePerson.bind(null, person.id)}
          confirm={`Move ${person.name} to the trash? You can restore them (with all chats, reads and coach conversations) for 30 days.`}
          className="btn-danger h-9 px-4"
        >
          Delete
        </ConfirmButton>
      </header>
      <PersonTabs id={person.id} />
      {children}
    </div>
  );
}
