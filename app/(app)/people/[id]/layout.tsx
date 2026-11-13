import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { getPerson } from "@/lib/data";
import { RELATIONS } from "@/lib/labels";
import { DeletePersonButton } from "@/components/delete-person-button";
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
        <DeletePersonButton id={person.id} name={person.name} />
      </header>
      <PersonTabs id={person.id} />
      {children}
    </div>
  );
}
