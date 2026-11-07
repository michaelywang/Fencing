import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SetupForm } from "@/components/auth/AuthForms";
import { setupStatus } from "@/server/services/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup" };

export default async function SetupPage() {
  const status = await setupStatus();
  if (!status.needsSetup) {
    return (
      <AuthShell title="Setup is complete">
        <p className="text-sm text-slate-700">
          An administrator account already exists, so this page is permanently disabled. <Link className="font-semibold text-gl-blue underline" href="/login">Sign in</Link> instead.
        </p>
      </AuthShell>
    );
  }
  if (!status.tokenConfigured) {
    return (
      <AuthShell title="Setup isn't configured yet">
        <p className="text-sm text-slate-700">
          Add a <code className="rounded bg-slate-100 px-1">SETUP_TOKEN</code> environment variable (at least 16 random characters) in your hosting settings, redeploy, and reload this page. See docs/DEPLOYMENT.md.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Create the head coach (administrator) account" subtitle="One-time setup. This page stops working after the first account is created.">
      <SetupForm />
    </AuthShell>
  );
}
