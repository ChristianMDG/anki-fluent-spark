import { useState } from "react";
import { Book, Plus, Check, Trash2, Volume2, ChevronDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { grammarToHtml, examplesToHtml, clozeToHtml } from "@/lib/parse-card";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { FullLessonModal } from "./FullLessonModal";

export interface CardRow {
  id: string;
  word: string;
  ipa: string | null;
  pos: string | null;
  level: string | null;
  definition: string | null;
  french: string | null;
  grammar: string | null;
  examples: string | null;
  cloze: string | null;
  exported: boolean;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function VocabCard({
  card,
  compact = false,
  onDelete,
}: {
  card: CardRow;
  compact?: boolean;
  onDelete?: () => void;
}) {
  const [openLesson, setOpenLesson] = useState(false);
  const [exported, setExported] = useState(card.exported);
  const [expanded, setExpanded] = useState(!compact);
  const qc = useQueryClient();

  async function toggleExport() {
    const next = !exported ? false : true; // preserve prior semantic (see history)
    const nextExportedValue = exported ? false : true;
    setExported(nextExportedValue);
    const { error } = await supabase
      .from("cards")
      .update({ exported: nextExportedValue })
      .eq("id", card.id);
    if (error) {
      setExported(exported);
      return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["cards"] });
    toast.success(!nextExportedValue ? "Added to export queue" : "Removed from queue");
    void next;
  }

  const showBody = expanded || !compact;

  return (
    <>
      <article
        className={`glass-panel p-5 md:p-7 space-y-4 group ${
          compact ? "hover:border-[color:var(--color-crimson-glow)]/60" : "animate-in fade-in zoom-in-95 duration-300"
        }`}
      >
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl md:text-2xl font-bold truncate">{card.word}</h2>
              <button
                onClick={() => speak(card.word)}
                title="Listen"
                className="p-1.5 rounded-md text-muted-foreground hover:text-[color:var(--color-gold)] hover:bg-white/5 transition opacity-0 group-hover:opacity-100"
              >
                <Volume2 size={14} />
              </button>
              {card.level && (
                <span className="label-mono text-[color:var(--color-gold)] px-2 py-0.5 rounded-md bg-[color:var(--color-gold)]/10">
                  {card.level}
                </span>
              )}
              {!exported && (
                <span className="label-mono text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300">
                  queued
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {card.ipa && <span className="font-mono">{card.ipa}</span>}
              {card.pos && <span>· {card.pos}</span>}
            </div>
          </div>

          {compact && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </header>

        {showBody && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {card.definition && (
              <section>
                <p className="label-mono mb-1">Definition</p>
                <p className="leading-relaxed">{card.definition}</p>
              </section>
            )}

            {card.french && (
              <section>
                <p className="label-mono mb-1">French</p>
                <p
                  className="text-[color:var(--color-gold)]"
                  dangerouslySetInnerHTML={{ __html: card.french }}
                />
              </section>
            )}

            {!compact && card.grammar && (
              <section>
                <p className="label-mono mb-1">Grammar</p>
                <div dangerouslySetInnerHTML={{ __html: grammarToHtml(card.grammar) }} />
              </section>
            )}

            {card.examples && (
              <section>
                <p className="label-mono mb-1">Examples</p>
                <div dangerouslySetInnerHTML={{ __html: examplesToHtml(card.examples) }} />
              </section>
            )}

            {!compact && card.cloze && (
              <section>
                <p className="label-mono mb-1">Cloze</p>
                <div dangerouslySetInnerHTML={{ __html: clozeToHtml(card.cloze) }} />
              </section>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => setOpenLesson(true)}
            className="btn-crimson rounded-lg px-4 py-2 text-sm flex items-center gap-2"
          >
            <Book size={15} /> Full lesson
          </button>
          <button
            onClick={toggleExport}
            className={`rounded-lg px-3.5 py-2 text-sm flex items-center gap-2 border transition ${
              !exported
                ? "border-[color:var(--color-gold)]/60 text-[color:var(--color-gold)] bg-[color:var(--color-gold)]/10"
                : "border-[color:var(--color-border)] text-muted-foreground hover:text-foreground hover:border-[color:var(--color-gold)]/40"
            }`}
          >
            {!exported ? <Check size={14} /> : <Plus size={14} />}
            {!exported ? "Queued" : "Add to export"}
          </button>
          {onDelete && (
            <button
              onClick={onDelete}
              className="ml-auto rounded-lg p-2 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition opacity-60 group-hover:opacity-100"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </article>

      {openLesson && (
        <FullLessonModal
          cardId={card.id}
          word={card.word}
          ipa={card.ipa ?? ""}
          level={card.level ?? ""}
          onClose={() => setOpenLesson(false)}
        />
      )}
    </>
  );
}
