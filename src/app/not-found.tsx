import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-gl-red">Not found</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">This page isn&apos;t available</h1>
      <p className="mt-2 text-slate-600">It may have been moved, unpublished, or never existed.</p>
      <Link href="/" className="mt-6 inline-block rounded-md bg-gl-blue px-4 py-2 font-semibold text-white">
        Go to the team calendar
      </Link>
    </main>
  );
}
