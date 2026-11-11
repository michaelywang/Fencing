"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LocationLite } from "@/lib/view";
import type { SeasonSummary } from "@/server/services/scope";
import { cx } from "@/components/ui";

export interface CoachUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "coach";
}

export interface CoachSettings {
  timezone: string;
  defaultPracticeMinutes: number;
  defaultPracticeStart: string;
  defaultPracticeLocationId: string | null;
  defaultMeetLocationId: string | null;
  teamName: string;
}

interface CoachCtx {
  user: CoachUser;
  settings: CoachSettings;
  locations: LocationLite[];
  coachNames: string[];
  today: string;
  /** Seasons and their planning tracks (coach-only). The SELECTED track lives in the tab's URL. */
  workspaces: SeasonSummary[];
}

const Ctx = createContext<CoachCtx | null>(null);

export function CoachProvider({ value, children }: { value: CoachCtx; children: ReactNode }) {
  return (
    <Ctx.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </Ctx.Provider>
  );
}

export function useCoach(): CoachCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCoach must be used inside CoachProvider");
  return v;
}

// ---------------------------------------------------------------------------
// Toasts (with optional Undo action)
// ---------------------------------------------------------------------------
interface Toast {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

type ToastInput = Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] };
const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setToasts((prev) => [...prev.slice(-3), { tone: "info", ...t, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.action ? 10_000 : 5_000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex flex-col items-center gap-2 px-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex max-w-lg items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg",
              t.tone === "error" ? "bg-red-700 text-white" : t.tone === "success" ? "bg-emerald-800 text-white" : "bg-slate-900 text-white",
            )}
          >
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="touch-target rounded px-2 py-1 font-bold text-amber-200 underline underline-offset-2 hover:text-white"
                onClick={() => {
                  t.action!.onClick();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            ) : null}
            <button type="button" aria-label="Dismiss" className="touch-target px-1 text-white/70 hover:text-white" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Modal (native <dialog>: focus trapping, Escape, and backdrop for free)
// ---------------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
      className={wide ? "max-w-[min(960px,calc(100vw-2rem))]" : undefined}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="touch-target rounded px-2 text-slate-500 hover:bg-slate-100">
              ✕
            </button>
          </div>
          <div className="overflow-y-auto px-4 py-3">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
