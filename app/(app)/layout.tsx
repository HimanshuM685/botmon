import Image from "next/image";
import Link from "next/link";
import { requireUser } from "@/lib/auth/server";
import { signOutAction } from "@/app/actions";

// Session is read from cookies on every request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/80 backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-5 sm:px-8">
          <Link href="/dashboard" className="display text-xl italic">botmon</Link>
          <Link href="/dashboard" className="text-sm text-muted hover:text-paper">People</Link>
          <Link href="/settings" className="text-sm text-muted hover:text-paper">Settings</Link>
          <div className="ml-auto flex items-center gap-3">
            {user.image && <Image src={user.image} alt="" width={28} height={28} className="rounded-full" />}
            <form action={signOutAction}>
              <button className="text-sm text-muted hover:text-paper">Sign out</button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:px-8">{children}</main>
    </div>
  );
}
