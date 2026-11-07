import { AuthShell } from "@/components/auth/AuthShell";
import { RecoverForm } from "@/components/auth/AuthForms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account recovery" };

export default function RecoverPage() {
  const enabled = (process.env.RECOVERY_TOKEN ?? "").length >= 24;
  return (
    <AuthShell title="Break-glass account recovery" subtitle="For when every administrator is locked out.">
      {enabled ? (
        <RecoverForm />
      ) : (
        <p className="text-sm text-slate-700">
          Recovery is turned off. To use it, the site owner sets a <code className="rounded bg-slate-100 px-1">RECOVERY_TOKEN</code> (24+ random characters) in the hosting environment, redeploys, uses this page once, then removes the variable. Details: docs/OPERATIONS.md → Account recovery.
        </p>
      )}
    </AuthShell>
  );
}
