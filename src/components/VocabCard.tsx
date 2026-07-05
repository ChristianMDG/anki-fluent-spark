import { useState } from "react";
import { Book, Plus, Check } from "lucide-react";
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

export function VocabCard({ card, compact = false }: { card: CardRow; compact?: boolean }) {
  const [openLesson, setOpenLesson] = useState(false);
  const [exported, setExported] = useState(card.exported);
  const qc = useQueryClient();

  async function markExport() {
    // Semantic: exported=false means "pending export" (in the export queue)
    // Toggle the flag; UI shows "Prête à exporter" when exported=false
    const newExported = !exported ? false : true;
    // Actually simpler: user clicks "Add to export" when card is not queued → set exported=false
    // and "Remove" when queued → set exported=true (i.e. treated as already exported)
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
    toast.success(!nextExportedValue ? "Ajoutée à l'export" : "Retirée de l'export");
    void newExported; // silence
  }

  return (
    <>
      <article
        className={`glass-panel p-6 md:p-8 space-y-4 ${compact ? "" : "animate-in fade-in zoom-in-95 duration-300"}`}
      >
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold">{card.word}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {card.ipa && <span className="font-mono">{card.ipa}</span>}
              {card.pos && <span>· {card.pos}</span>}
              {card.level && (
                <span className="label-mono text-[color:var(--color-gold)]">{card.level}</span>
              )}
            </div>
          </div>
        </header>

        {card.definition && (
          <section>
            <p className="label-mono mb-1">Definition</p>
            <p>{card.definition}</p>
          </section>
        )}

        {card.french && (
          <section>
            <p className="label-mono mb-1">Français</p>
            <p className="text-[color:var(--color-gold)]">{card.french}</p>
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

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={() => setOpenLesson(true)}
            className="btn-crimson rounded-lg px-4 py-2.5 text-sm flex items-center gap-2"
          >
            <Book size={16} /> Leçon complète
          </button>
          <button
            onClick={markExport}
            className={`rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 border transition ${
              !exported
                ? "border-[color:var(--color-gold)] text-[color:var(--color-gold)] bg-[color:var(--color-gold)]/10"
                : "border-[color:var(--color-border)] text-muted-foreground hover:text-foreground"
            }`}
          >
            {!exported ? <Check size={16} /> : <Plus size={16} />}
            {!exported ? "Prête à exporter" : "Ajouter à l'export"}
          </button>
        </div>
      </article>

      {openLesson && (
        <FullLessonModal cardId={card.id} word={card.word} ipa={card.ipa ?? ""} level={card.level ?? ""} onClose={() => setOpenLesson(false)} />
      )}
    </>
  );
}
