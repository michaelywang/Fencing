"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-gl-red">Something went wrong</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">We couldn&apos;t load this page</h1>
      <p className="mt-2 text-slate-600">Check your connection and try again. If it keeps happening, let a coach know.</p>
      <button type="button" onClick={reset} className="mt-6 rounded-md bg-gl-blue px-4 py-2 font-semibold text-white">
        Try again
      </button>
    </main>
  );
}
