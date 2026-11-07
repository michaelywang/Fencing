import Link from "next/link";
import type { ReactNode } from "react";
import { Claymore } from "@/components/Logo";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-gl-blue">
      <div className="h-1 bg-gl-red" />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="mb-5 flex items-center justify-center gap-2 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-gl-red">
            <Claymore className="h-7 w-7" />
          </span>
          <span className="text-lg font-bold">GL Fencing · Coaches</span>
        </div>
        <div className="rounded-xl bg-white p-6 shadow-xl">
          <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-sm text-blue-100">
          Students and families don&apos;t need an account —{" "}
          <Link href="/" className="font-semibold text-white underline">
            view the team calendar
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
