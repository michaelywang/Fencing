import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/AuthForms";
import { getCurrentSession } from "@/server/http";
import { setupStatus } from "@/server/services/accounts";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coach sign-in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentSession()) redirect(next?.startsWith("/coach") ? next : "/coach");
  const status = await setupStatus();
  return (
    <AuthShell title="Coach sign-in" subtitle="Editing is for coaches only.">
      {status.needsSetup ? (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No accounts exist yet. The head coach should start with <Link className="font-semibold underline" href="/setup">first-time setup</Link>.
        </p>
      ) : null}
      <LoginForm next={next} />
    </AuthShell>
  );
}
