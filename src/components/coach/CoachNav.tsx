"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/Logo";
import { cx } from "@/components/ui";
import { api } from "@/lib/api-client";
import { useCoach } from "./CoachContext";
import { useTrackHref } from "./TrackBar";

const LINKS = [
  { href: "/coach/calendar", label: "Month" },
  { href: "/coach/week", label: "Week" },
  { href: "/coach/drills", label: "Drill library" },
  { href: "/coach/templates", label: "Templates" },
  { href: "/coach/season", label: "Season" },
  { href: "/coach/tracks", label: "Tracks" },
  { href: "/coach/publish", label: "Publish" },
  { href: "/coach/backups", label: "Backups" },
  { href: "/coach/import", label: "Import" },
  { href: "/coach/trash", label: "Trash" },
];

export function CoachNav() {
  const { user } = useCoach();
  const pathname = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const withTrack = useTrackHref();
  const links = (user.role === "admin" ? [...LINKS, { href: "/coach/admin", label: "Admin" }] : LINKS).map((l) => ({ ...l, to: l.href === "/coach/admin" ? l.href : withTrack(l.href) }));

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } finally {
      for (const k of Object.keys(localStorage)) if (k.startsWith("glf.backup.")) localStorage.removeItem(k);
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <header className="no-print sticky top-0 z-40 border-b-4 border-gl-red bg-gl-blue text-white">
      <div className="on-dark mx-auto flex max-w-[1600px] items-center gap-3 px-3 py-1.5">
        <Link href={withTrack("/coach/calendar")} className="shrink-0 rounded-md">
          <Wordmark name="GL Fencing" sub="Coach planner" />
        </Link>
        <nav aria-label="Coach" className="hidden flex-1 xl:block">
          <ul className="flex flex-wrap gap-0.5">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.to}
                  aria-current={pathname.startsWith(l.href) ? "page" : undefined}
                  className={cx(
                    "inline-flex h-9 items-center rounded-md px-2.5 text-sm font-semibold",
                    pathname.startsWith(l.href) ? "bg-white text-gl-blue" : "text-white hover:bg-white/10",
                  )}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/" target="_blank" className="hidden rounded-md px-2 py-1 text-sm font-semibold text-blue-100 underline hover:text-white sm:inline">
            Public site ↗
          </Link>
          <div className="relative">
            <button
              type="button"
              aria-expanded={menu}
              aria-haspopup="menu"
              onClick={() => setMenu((v) => !v)}
              className="touch-target flex h-9 items-center gap-1 rounded-md bg-white/10 px-2.5 text-sm font-semibold hover:bg-white/20"
            >
              <span className="hidden sm:inline">{user.name}</span>
              <span className="sm:hidden">Menu</span>
              <span aria-hidden>▾</span>
            </button>
            {menu ? (
              <div role="menu" className="absolute right-0 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-xl">
                <div className="xl:hidden">
                  {links.map((l) => (
                    <Link key={l.href} role="menuitem" href={l.to} onClick={() => setMenu(false)} className={cx("block px-3 py-2 text-sm hover:bg-slate-100", pathname.startsWith(l.href) && "font-bold text-gl-blue")}>
                      {l.label}
                    </Link>
                  ))}
                  <hr className="my-1" />
                </div>
                <p className="px-3 py-1 text-xs text-slate-500">
                  Signed in as {user.email} ({user.role})
                </p>
                <Link role="menuitem" href="/coach/account" onClick={() => setMenu(false)} className="block px-3 py-2 text-sm hover:bg-slate-100">
                  My account & password
                </Link>
                <Link role="menuitem" href="/" target="_blank" className="block px-3 py-2 text-sm hover:bg-slate-100">
                  Open public site ↗
                </Link>
                <button role="menuitem" type="button" onClick={signOut} className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
