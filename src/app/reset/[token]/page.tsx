import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetForm } from "@/components/auth/AuthForms";
import { getReset } from "@/server/services/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const reset = await getReset(token);
  if (!reset) {
    return (
      <AuthShell title="Reset link not valid">
        <p className="text-sm text-slate-700">
          This link has expired or was already used. Ask an administrator for a new one, or <Link href="/forgot" className="font-semibold text-gl-blue underline">see other options</Link>.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Choose a new password">
      <ResetForm token={token} email={reset.email} />
    </AuthShell>
  );
}
