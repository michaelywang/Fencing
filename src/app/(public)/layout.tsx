import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { PublicNav } from "@/components/public/PublicNav";
import { getPublicMeta } from "@/server/services/public";
import { formatTimestamp } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const meta = await getPublicMeta();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="no-print border-b-4 border-gl-red bg-gl-blue text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <Link href="/" className="on-dark rounded-md">
            <Wordmark name={meta.shortName} sub="Team calendar" />
          </Link>
          <PublicNav />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4">
        {children}
      </main>
      <footer className="no-print border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-slate-600">
          <p>
            {meta.lastUpdatedAt ? <>Last updated {formatTimestamp(meta.lastUpdatedAt, meta.timezone)}</> : "Not updated yet"}
            {meta.lastNote ? <> · “{meta.lastNote}”</> : null}
          </p>
          <p className="flex items-center gap-3">
            <span>{meta.teamName} · read-only team calendar</span>
            <Link href="/login" className="font-semibold text-gl-blue underline">
              Coach sign-in
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
