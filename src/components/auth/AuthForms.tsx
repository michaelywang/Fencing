"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button, Label, Notice, inputClass } from "@/components/ui";

/** After signing in, load the coach area fresh so server components see the new session. */
function useGoTo() {
  const router = useRouter();
  return (path: string) => {
    router.replace(path);
    router.refresh();
  };
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/coach") && !next.startsWith("//") ? next : "/coach";
}

function Field({ id, label, hint, ...props }: { id: string; label: string; hint?: ReactNode } & React.ComponentProps<"input">) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <input id={id} name={id} className={inputClass} {...props} />
    </div>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const { busy, error, run } = useSubmit();
  const goTo = useGoTo();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
      goTo(safeNext(next));
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="email" label="Email" type="email" autoComplete="username" required autoFocus />
      <Field id="password" label="Password" type="password" autoComplete="current-password" required />
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/forgot" className="text-gl-blue underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

export function SetupForm() {
  const { busy, error, run } = useSubmit();
  const goTo = useGoTo();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) {
      void run(async () => {
        throw new ApiError(400, "mismatch", "The two passwords don't match.");
      });
      return;
    }
    void run(async () => {
      await api("/api/auth/setup", {
        body: { setupToken: f.get("setupToken"), name: f.get("name"), email: f.get("email"), password: f.get("password"), loadDemo: f.get("loadDemo") === "on" },
      });
      goTo("/coach");
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="setupToken" label="Setup token" hint="(the SETUP_TOKEN value from your hosting settings)" type="password" autoComplete="off" required />
      <Field id="name" label="Your name" autoComplete="name" required />
      <Field id="email" label="Email (your username)" type="email" autoComplete="username" required />
      <Field id="password" label="Password" hint="(10+ characters)" type="password" autoComplete="new-password" minLength={10} required />
      <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" minLength={10} required />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" name="loadDemo" className="mt-1 h-4 w-4" />
        <span>Load the fictional demonstration season (clearly labeled; remove it anytime in Admin → Demo content).</span>
      </label>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create administrator account"}
      </Button>
    </form>
  );
}

export function InviteForm({ token, email, suggestedName }: { token: string; email: string; suggestedName: string }) {
  const { busy, error, run } = useSubmit();
  const goTo = useGoTo();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) {
      void run(async () => {
        throw new ApiError(400, "mismatch", "The two passwords don't match.");
      });
      return;
    }
    void run(async () => {
      await api("/api/auth/invite", { body: { token, name: f.get("name"), password: f.get("password") } });
      goTo("/coach");
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div>
        <Label>Email (your username)</Label>
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{email}</p>
      </div>
      <Field id="name" label="Your name" defaultValue={suggestedName} autoComplete="name" required />
      <Field id="password" label="Choose a password" hint="(10+ characters)" type="password" autoComplete="new-password" minLength={10} required />
      <Field id="confirm" label="Confirm password" type="password" autoComplete="new-password" minLength={10} required />
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Create my coach account"}
      </Button>
    </form>
  );
}

export function ResetForm({ token, email }: { token: string; email: string }) {
  const { busy, error, run } = useSubmit();
  const goTo = useGoTo();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) {
      void run(async () => {
        throw new ApiError(400, "mismatch", "The two passwords don't match.");
      });
      return;
    }
    void run(async () => {
      await api("/api/auth/reset", { body: { token, password: f.get("password") } });
      goTo("/coach");
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm text-slate-700">
        Setting a new password for <strong>{email}</strong>. You will be signed out on other devices.
      </p>
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field id="password" label="New password" hint="(10+ characters)" type="password" autoComplete="new-password" minLength={10} required />
      <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" minLength={10} required />
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}

export function ForgotForm({ emailEnabled }: { emailEnabled: boolean }) {
  const { busy, error, run } = useSubmit();
  const [done, setDone] = useState(false);
  if (!emailEnabled) {
    return (
      <div className="space-y-3 text-sm text-slate-700">
        <p>This site doesn&apos;t send email. To reset your password:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>Ask your head coach (an administrator) to open <strong>Admin → Coaches</strong> and create a reset link for you.</li>
          <li>If every administrator is locked out, follow “Account recovery” in the operations guide (docs/OPERATIONS.md).</li>
        </ul>
      </div>
    );
  }
  if (done) return <Notice tone="success">If that email belongs to a coach account, a reset link is on its way. It expires in 1 hour.</Notice>;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      await api("/api/auth/forgot", { body: { email: f.get("email") } });
      setDone(true);
    });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="email" label="Email" type="email" autoComplete="username" required />
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}

export function RecoverForm() {
  const { busy, error, run } = useSubmit();
  const [link, setLink] = useState<string | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(async () => {
      const res = await api<{ url: string }>("/api/auth/recover", { body: { recoveryToken: f.get("recoveryToken"), email: f.get("email") } });
      setLink(res.url);
    });
  };
  if (link) {
    return (
      <div className="space-y-3">
        <Notice tone="success">Recovery link created (valid for 1 hour). Open it to set a new password, then remove RECOVERY_TOKEN from your hosting settings.</Notice>
        <a href={link} className="block break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-gl-blue underline">
          {link}
        </a>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Field id="recoveryToken" label="Recovery token" hint="(RECOVERY_TOKEN from hosting settings)" type="password" autoComplete="off" required />
      <Field id="email" label="Account email" type="email" autoComplete="username" required />
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? "Checking…" : "Create recovery link"}
      </Button>
    </form>
  );
}
