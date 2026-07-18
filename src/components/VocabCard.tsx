import { useState } from "react";
import { Book, Plus, Check, Trash2, Volume2, ChevronDown, AlertTriangle, X, Fingerprint } from "lucide-react";
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
  tags: string[] | null;
  needs_review: boolean;
}

const SUGGESTED_TAGS = ["Entretien", "Quotidien", "Tech", "Voyage", "Académique"];

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
  const [tags, setTags] = useState<string[]>(card.tags ?? []);
  const [needsReview, setNeedsReview] = useState(card.needs_review);
  const [newTag, setNewTag] = useState("");
  const qc = useQueryClient();

  async function toggleExport() {
    const nextExportedValue = !exported;
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
    toast.success(nextExportedValue ? "Removed from queue" : "Added to export queue");
  }

  async function persistTags(next: string[]) {
    const prev = tags;
    setTags(next);
    const { error } = await supabase.from("cards").update({ tags: next }).eq("id", card.id);
    if (error) {
      setTags(prev);
      return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["cards"] });
  }

  function toggleTag(t: string) {
    const clean = t.trim();
    if (!clean) return;
    if (tags.includes(clean)) persistTags(tags.filter((x) => x !== clean));
    else persistTags([...tags, clean]);
  }

  async function markReviewed() {
    setNeedsReview(false);
    const { error } = await supabase
      .from("cards")
      .update({ needs_review: false })
      .eq("id", card.id);
    if (error) {
      setNeedsReview(true);
      return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Marked as reviewed");
  }

  const showBody = expanded || !compact;
  const dossierNumber = card.id.replace(/-/g, "").slice(0, 6).toUpperCase();

  return (
    <>
      <article
        className={`relative flex flex-col h-full glass-panel p-5 md:p-6 group overflow-hidden ${
          compact ? "hover:border-[color:var(--color-crimson-glow)]/60" : "animate-in fade-in zoom-in-95 duration-300"
        } ${needsReview ? "!border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]" : ""}`}
      >
        {/* Scanline sweep on hover — echoes the dashboard HUD language */}
        <div className="pointer-events-none absolute inset-x-0 h-[1px] bg-[var(--color-crimson)]/25 opacity-0 group-hover:opacity-100 group-hover:animate-[scanline_2.4s_infinite_linear] z-0" />

        {/* Ambient corner glow */}
        <div className="pointer-events-none absolute -top-12 -right-12 w-32 h-32 bg-[var(--color-crimson)]/10 rounded-full blur-2xl" />

        {/* Dossier strip: file number + status stamp */}
        <div className="flex items-center justify-between mb-3 relative z-[1]">
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            <Fingerprint size={11} />
            <span className="label-mono text-[9px] tracking-[0.2em]">FILE #{dossierNumber}</span>
          </div>

          {needsReview ? (
            <span className="label-mono text-[9px] tracking-[0.15em] text-amber-300 border border-amber-500/50 rounded px-2 py-0.5 rotate-[-4deg] bg-amber-500/10 flex items-center gap-1">
              <AlertTriangle size={10} /> À REVOIR
            </span>
          ) : !exported ? (
            <span className="label-mono text-[9px] tracking-[0.15em] text-emerald-300 border border-emerald-500/50 rounded px-2 py-0.5 rotate-[-4deg] bg-emerald-500/10">
              EN FILE
            </span>
          ) : (
            <span className="label-mono text-[9px] tracking-[0.15em] text-muted-foreground/50 border border-[color:var(--color-border)] rounded px-2 py-0.5 rotate-[-4deg]">
              EXPORTÉ
            </span>
          )}
        </div>

        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 relative z-[1]">
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
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {card.ipa && <span className="font-mono">{card.ipa}</span>}
              {card.pos && <span>· {card.pos}</span>}
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--color-crimson)]/20 text-[color:var(--color-cream)]/90 border border-[color:var(--color-crimson)]/30"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {card.level && (
              <div
                className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-[color:var(--color-gold)]/25 to-[color:var(--color-gold)]/5 border border-[color:var(--color-gold)]/50 text-[color:var(--color-gold)] label-mono text-[10px] font-bold shadow-[0_0_10px_rgba(212,175,55,0.15)]"
                style={{ clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" }}
                title={`Level ${card.level}`}
              >
                {card.level}
              </div>
            )}
            {compact && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>
        </header>

        {showBody && (
          <div className="space-y-3 mt-4 animate-in fade-in duration-200 relative z-[1]">
            {card.definition && (
              <section className="pl-3 border-l-2 border-[color:var(--color-crimson)]/50">
                <p className="label-mono mb-1 text-[9px] tracking-[0.15em] text-muted-foreground/70">
                  DEFINITION
                </p>
                <p className="leading-relaxed text-sm">{card.definition}</p>
              </section>
            )}

            {card.french && (
              <section className="pl-3 border-l-2 border-[color:var(--color-gold)]/50">
                <p className="label-mono mb-1 text-[9px] tracking-[0.15em] text-muted-foreground/70">
                  FRANÇAIS
                </p>
                <p
                  className="text-[color:var(--color-gold)] text-sm"
                  dangerouslySetInnerHTML={{ __html: card.french }}
                />
              </section>
            )}

            {!compact && card.grammar && (
              <section className="pl-3 border-l-2 border-white/15">
                <p className="label-mono mb-1 text-[9px] tracking-[0.15em] text-muted-foreground/70">
                  GRAMMAR
                </p>
                <div className="text-sm" dangerouslySetInnerHTML={{ __html: grammarToHtml(card.grammar) }} />
              </section>
            )}

            {card.examples && (
              <section className="pl-3 border-l-2 border-white/15">
                <p className="label-mono mb-1 text-[9px] tracking-[0.15em] text-muted-foreground/70">
                  EXAMPLES
                </p>
                <div className="text-sm" dangerouslySetInnerHTML={{ __html: examplesToHtml(card.examples) }} />
              </section>
            )}

            {!compact && card.cloze && (
              <section className="pl-3 border-l-2 border-[color:var(--color-crimson)]/30">
                <p className="label-mono mb-1 text-[9px] tracking-[0.15em] text-muted-foreground/70">
                  CLOZE
                </p>
                <div className="text-sm" dangerouslySetInnerHTML={{ __html: clozeToHtml(card.cloze) }} />
              </section>
            )}
          </div>
        )}

        {/* Actions pinned to the bottom so every card in the grid aligns, regardless of content length */}
        <div className="mt-auto pt-4 relative z-[1]">
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[color:var(--color-border)]/60">
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
            {needsReview && (
              <button
                onClick={markReviewed}
                className="rounded-lg px-3 py-2 text-sm flex items-center gap-1.5 border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 transition"
              >
                <Check size={14} /> Marquer révisé
              </button>
            )}
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

          {!compact && (
            <div className="pt-4 mt-4 border-t border-[color:var(--color-border)] space-y-2">
              <p className="label-mono text-[9px] tracking-[0.15em] text-muted-foreground/70">TAGS</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[color:var(--color-crimson)]/25 border border-[color:var(--color-crimson)]/40"
                  >
                    {t}
                    <button
                      onClick={() => toggleTag(t)}
                      className="hover:text-red-300"
                      aria-label={`Remove ${t}`}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {SUGGESTED_TAGS.filter((s) => !tags.includes(s)).map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleTag(s)}
                    className="text-xs px-2 py-1 rounded-full border border-dashed border-[color:var(--color-border)] text-muted-foreground hover:text-foreground hover:border-[color:var(--color-crimson-glow)] transition"
                  >
                    + {s}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTag.trim()) return;
                  toggleTag(newTag);
                  setNewTag("");
                }}
                className="flex gap-1 pt-1"
              >
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Ajouter un tag…"
                  className="flex-1 glass-panel-soft text-xs px-2.5 py-1.5 rounded-md focus:outline-none focus:ring-1 focus:ring-[color:var(--color-crimson-glow)]"
                  maxLength={30}
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 rounded-md bg-[color:var(--color-crimson)]/30 hover:bg-[color:var(--color-crimson)]/50 text-xs"
                >
                  <Plus size={13} />
                </button>
              </form>
            </div>
          )}
        </div>
      </article>

      {openLesson && (
        <FullLessonModal
          cardId={card.id}
          word={card.word}
          ipa={card.ipa ?? ""}
          level={card.level ?? ""}
          initialNeedsReview={needsReview}
          onReviewChange={setNeedsReview}
          onClose={() => setOpenLesson(false)}
        />
      )}
    </>
  );
}