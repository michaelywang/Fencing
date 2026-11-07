import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotForm } from "@/components/auth/AuthForms";
import { emailEnabled } from "@/server/email";

export const dynamic = "force-dynamic";
export const metadata = { title: "Forgot password" };

export default function ForgotPage() {
  return (
    <AuthShell title="Forgot your password?">
      <ForgotForm emailEnabled={emailEnabled()} />
    </AuthShell>
  );
}
