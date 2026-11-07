/** Subtle claymore (two-handed Highland sword) mark — an original, simple geometric drawing. */
export function Claymore({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {/* blade */}
        <path d="M16 2.5 L17.6 6 L17.6 20 L14.4 20 L14.4 6 Z" fill="currentColor" fillOpacity="0.18" />
        {/* cross-guard with forward-sloping quillons */}
        <path d="M8 21.5 C10 20.2 12 20 16 20 C20 20 22 20.2 24 21.5" />
        <path d="M8 21.5 l-1.2 1.6 M24 21.5 l1.2 1.6" />
        {/* grip and pommel */}
        <path d="M16 20.2 L16 27" />
        <circle cx="16" cy="28.6" r="1.6" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Wordmark({ name, sub }: { name: string; sub?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gl-red text-white shadow-inner">
        <Claymore className="h-6 w-6 claymore-mark" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-bold tracking-tight">{name}</span>
        {sub ? <span className="block text-[11px] font-medium uppercase tracking-wider text-blue-100">{sub}</span> : null}
      </span>
    </span>
  );
}
