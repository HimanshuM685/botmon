"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function PersonTabs({ id }: { id: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/people/${id}`, label: "Read" },
    { href: `/people/${id}/coach`, label: "Coach" },
    { href: `/people/${id}/timeline`, label: "Timeline" },
  ];
  return (
    <nav aria-label="Sections" className="flex gap-1 border-b border-line">
      {tabs.map((t) => {
        const active = path === t.href;
        return (
          <Link
            key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition ${active ? "border-heart text-paper" : "border-transparent text-muted hover:text-paper"}`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
