"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { Button, Notice, inputClass } from "@/components/ui";
import { useCoach, useToast } from "./CoachContext";

export function AccountPage() {
  const { user } = useCoach();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);

  async function saveName() {
    setError(null);
    try {
      await api("/api/account", { method: "PATCH", body: { name } });
      toast({ message: "Name updated.", tone: "success" });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    }
  }
  async function changePassword() {
    setError(null);
    if (pw.next !== pw.confirm) {
      setError("The new passwords don't match.");
      return;
    }
    try {
      await api("/api/account/password", { body: { current: pw.current, next: pw.next } });
      setPw({ current: "", next: "", confirm: "" });
      toast({ message: "Password changed. Other devices were signed out.", tone: "success" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the password.");
    }
  }
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-bold text-slate-900">My account</h1>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-sm text-slate-600">
          Username: <strong>{user.email}</strong> · {user.role === "admin" ? "Administrator" : "Coach"}
        </p>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Display name</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <Button onClick={saveName} disabled={!name.trim() || name === user.name}>
          Save name
        </Button>
      </section>
      <form
        className="space-y-2 rounded-lg border border-slate-200 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void changePassword();
        }}
      >
        <h2 className="text-sm font-bold text-slate-900">Change password</h2>
        <input type="email" autoComplete="username" value={user.email} readOnly hidden />
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Current password</span>
          <input type="password" className={inputClass} autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        </label>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">New password (10+ characters)</span>
          <input type="password" className={inputClass} autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        </label>
        <label className="block text-sm">
          <span className="mb-0.5 block text-xs font-semibold text-slate-700">Confirm new password</span>
          <input type="password" className={inputClass} autoComplete="new-password" minLength={10} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
        </label>
        <Button type="submit" variant="primary">
          Change password
        </Button>
      </form>
    </div>
  );
}
