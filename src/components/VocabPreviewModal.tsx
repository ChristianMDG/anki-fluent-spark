import { useEffect } from "react";
import { X, Volume2, Book, Loader2 } from "lucide-react";
import { examplesToHtml } from "@/lib/parse-card";
import type { CardRow } from "./VocabCard";

interface Props {
  word: string;
  card: CardRow | null;
  loading?: boolean;
  onOpenFullLesson: () => void;
  onClose: () => void;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function VocabPreviewModal({
  word,
  card,
  loading = false,
  onOpenFullLesson,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayWord = card?.word || word;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 motion-reduce:animate-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-panel w-full max-w-lg mx-auto flex flex-col overflow-hidden relative shadow-2xl animate-in zoom-in-95 duration-200 motion-reduce:animate-none">
        {/* Header */}
        <header className="flex items-center justify-between p-4 md:p-5 border-b border-[color:var(--color-border)] bg-black/40 backdrop-blur">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-white truncate">{displayWord}</h2>
            {card?.level && (
              <span className="label-mono text-xs text-[color:var(--color-gold)] border border-[color:var(--color-gold)]/40 bg-[color:var(--color-gold)]/10 rounded px-2 py-0.5 shrink-0">
                {card.level}
              </span>
            )}
            {card?.ipa && (
              <span className="font-mono text-xs text-muted-foreground shrink-0">{card.ipa}</span>
            )}
            {card && (
              <button
                onClick={() => speak(displayWord)}
                title="Pronounce"
                className="p-1.5 rounded-md text-muted-foreground hover:text-[color:var(--color-gold)] hover:bg-white/5 transition shrink-0"
              >
                <Volume2 size={16} />
              </button>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-white hover:bg-white/10 rounded-lg transition shrink-0"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </header>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
              <Loader2 size={24} className="animate-spin text-[color:var(--color-crimson)]" />
              <p className="text-sm font-medium">Compiling 13-field flashcard for "{word}"…</p>
            </div>
          ) : card ? (
            <div className="space-y-4">
              {card.definition && (
                <section className="pl-3.5 border-l-2 border-[color:var(--color-crimson)]/50 space-y-1">
                  <p className="label-mono text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    DEFINITION
                  </p>
                  <p className="text-sm text-neutral-200 leading-relaxed">{card.definition}</p>
                </section>
              )}

              {card.french && (
                <section className="pl-3.5 border-l-2 border-[color:var(--color-gold)]/50 space-y-1">
                  <p className="label-mono text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    FRANÇAIS
                  </p>
                  <p
                    className="text-sm text-[color:var(--color-gold)] leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: card.french }}
                  />
                </section>
              )}

              {card.examples && (
                <section className="pl-3.5 border-l-2 border-white/10 space-y-1">
                  <p className="label-mono text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    EXAMPLES
                  </p>
                  <div
                    className="text-sm text-neutral-300 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: examplesToHtml(card.examples) }}
                  />
                </section>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">Card details unavailable.</p>
          )}
        </div>

        {/* Footer Actions */}
        {card && (
          <footer className="p-4 border-t border-[color:var(--color-border)] bg-black/30 backdrop-blur flex items-center justify-between gap-3">
            <button
              onClick={onOpenFullLesson}
              className="btn-crimson rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 shadow-[0_0_15px_rgba(237,28,36,0.2)] transition"
            >
              <Book size={14} /> Open full lesson →
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs border border-[color:var(--color-border)] text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
            >
              Close
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
