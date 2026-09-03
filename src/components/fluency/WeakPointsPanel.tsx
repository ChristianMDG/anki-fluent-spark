import { CheckCircle2 } from "lucide-react";
import type { LearnerWeakPoint } from "@/integrations/supabase/learner-profile.types";

interface WeakPointsPanelProps {
  weakPoints: LearnerWeakPoint[];
  onResolve: (id: string) => void;
  /** compact=true shows a single "Working on: tag1, tag2" line with inline resolve buttons */
  compact?: boolean;
}

/**
 * WeakPointsPanel — shared between the Fluency entry screen (compact) and the
 * Journal (expanded list). Treats weak points neutrally as coach's private notes,
 * never as mistakes or failures. No red/warning colors.
 */
export function WeakPointsPanel({ weakPoints, onResolve, compact = false }: WeakPointsPanelProps) {
  const unresolved = weakPoints.filter((p) => !p.resolved);
  if (unresolved.length === 0) return null;

  if (compact) {
    const top = unresolved.slice(0, 2);
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="label-mono text-xs">Working on:</span>
        {top.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-white/5 px-2.5 py-0.5 text-xs"
          >
            <span>{p.tag}</span>
            <button
              onClick={() => onResolve(p.id)}
              className="text-muted-foreground hover:text-[color:var(--color-gold)] transition motion-safe:transition-colors"
              title="Mark as resolved"
              aria-label={`Mark "${p.tag}" as resolved`}
            >
              <CheckCircle2 size={11} />
            </button>
          </span>
        ))}
      </div>
    );
  }

  // Expanded list for Journal
  return (
    <div className="space-y-2">
      {unresolved.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between gap-3 rounded-lg bg-white/5 border border-[color:var(--color-border)] px-3 py-2"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="label-mono text-xs text-[color:var(--color-gold)]">{p.tag}</span>
              <span className="text-xs text-muted-foreground">
                × {p.occurrences} {p.occurrences === 1 ? "time" : "times"}
              </span>
            </div>
            {p.example && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 italic">
                {p.example}
              </p>
            )}
          </div>
          <button
            onClick={() => onResolve(p.id)}
            className="shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted-foreground border border-[color:var(--color-border)] hover:border-[color:var(--color-gold)]/50 hover:text-[color:var(--color-gold)] transition motion-safe:transition-colors"
            aria-label={`Mark "${p.tag}" as resolved`}
          >
            <CheckCircle2 size={12} />
            Resolved
          </button>
        </div>
      ))}
    </div>
  );
}
