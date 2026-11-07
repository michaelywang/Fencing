"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/month", label: "Month" },
  { href: "/season", label: "Season" },
];

export function PublicNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Team calendar" className="on-dark">
      <ul className="flex gap-1 overflow-x-auto">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "touch-target inline-flex h-10 items-center rounded-md px-3 text-sm font-semibold",
                  active ? "bg-white text-gl-blue" : "text-white hover:bg-white/10",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
