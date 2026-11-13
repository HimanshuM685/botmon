import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { purgeDate } from "@/lib/trash";
import { restoreAccount, signOutAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account scheduled for deletion" };

export default async function RestoreAccount() {
  const { data } = await auth.getSession();
  if (!data?.user) redirect("/");
  const row = await db.user.findUnique({ where: { id: data.user.id }, select: { deletedAt: true } });
  if (!row?.deletedAt) redirect("/dashboard");

  return (
    <main className="mx-auto grid min-h-full max-w-lg place-items-center px-5 py-16">
      <div className="card w-full p-8 text-center">
        <h1 className="display text-3xl">Your account is scheduled for deletion.</h1>
        <p className="mt-4 text-muted">
          Everything will be permanently erased on{" "}
          <strong className="text-paper">{purgeDate(row.deletedAt).toLocaleDateString(undefined, { dateStyle: "long" })}</strong>.
          Until then you can bring it all back.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <form action={restoreAccount}><button className="btn-primary">Restore my account</button></form>
          <form action={signOutAction}><button className="btn-ghost">Keep it deleted</button></form>
        </div>
      </div>
    </main>
  );
}
