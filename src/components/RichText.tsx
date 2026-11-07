import { Fragment, type ReactNode } from "react";
import { safeUrl } from "@/lib/text";

/**
 * Renders the constrained Markdown subset used for coach-authored text:
 * paragraphs, line breaks, "- " / "* " bullet lists, "1. " numbered lists,
 * **bold**, *italic*, [label](https://…) links and bare https:// URLs.
 * Output is built from React elements only — raw HTML is never interpreted,
 * and links are limited to http(s)/mailto.
 */
export function RichText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text || !text.trim()) return null;
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return (
    <div className={className ?? "space-y-2 text-sm leading-relaxed text-slate-800"}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

function renderBlock(block: string, key: number): ReactNode {
  const lines = block.split("\n").filter((l) => l.trim() !== "");
  if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
    return (
      <ul key={key} className="ml-5 list-disc space-y-0.5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
        ))}
      </ul>
    );
  }
  if (lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return (
      <ol key={key} className="ml-5 list-decimal space-y-0.5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>
        ))}
      </ol>
    );
  }
  return (
    <p key={key}>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {inline(l)}
        </Fragment>
      ))}
    </p>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<>()]+)/g;

export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t)!;
      const url = safeUrl(mm[2]);
      out.push(url ? <ExternalLink key={k++} href={url}>{mm[1]}</ExternalLink> : mm[1]);
    } else if (t.startsWith("http")) {
      const url = safeUrl(t);
      out.push(url ? <ExternalLink key={k++} href={url}>{t.replace(/^https?:\/\//, "").slice(0, 60)}</ExternalLink> : t);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={className ?? "font-medium text-gl-blue underline underline-offset-2 hover:text-gl-blue-dark"}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
