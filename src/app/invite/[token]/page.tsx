import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { InviteForm } from "@/components/auth/AuthForms";
import { getInvite } from "@/server/services/accounts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invite" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvite(token);
  if (!invite) {
    return (
      <AuthShell title="Invite link not valid">
        <p className="text-sm text-slate-700">
          This invite has expired, was already used, or was replaced by a newer one. Ask your head coach to send a new invite. Already have an account?{" "}
          <Link href="/login" className="font-semibold text-gl-blue underline">Sign in</Link>.
        </p>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Join the coaching staff" subtitle={`You've been invited as ${invite.role === "admin" ? "an administrator" : "a coach"}.`}>
      <InviteForm token={token} email={invite.email} suggestedName={invite.name} />
    </AuthShell>
  );
}
