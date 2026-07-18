import { useState } from "react";
import {
  Book,
  Plus,
  Check,
  Trash2,
  Volume2,
  ChevronDown,
  AlertTriangle,
  X,
  Fingerprint,
  Bookmark,
  BookmarkCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { grammarToHtml, examplesToHtml, clozeToHtml } from "@/lib/parse-card";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { FullLessonModal } from "./FullLessonModal";
import { confirmDialog } from "@/components/ConfirmDialog";

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

const SUGGESTED_TAGS = ["Interview", "Daily Life", "Tech", "Travel", "Academic"];

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

  async function handleConfirmDelete() {
    if (!onDelete) return;
    const ok = await confirmDialog({
      title: "Delete this card?",
      description: `The word "${card.word}" will be permanently removed from your review list.`,
      confirmLabel: "Delete",
    });
    if (ok) {
      onDelete();
    }
  }

  const showBody = expanded || !compact;
  const dossierNumber = card.id.replace(/-/g, "").slice(0, 6).toUpperCase();

  return (
    <>
      <article
        className={`relative flex flex-col h-full min-h-[440px] max-h-[560px] glass-panel p-5 group overflow-hidden transition-all duration-300 ${
          compact
            ? "hover:border-[color:var(--color-crimson-glow)]/60"
            : "animate-in fade-in zoom-in-95 duration-300"
        } ${needsReview ? "!border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]" : ""}`}
      >
        {/* Scanline element */}
        <div className="pointer-events-none absolute inset-x-0 h-[1px] bg-[var(--color-crimson)]/25 opacity-0 group-hover:opacity-100 group-hover:animate-[scanline_2.4s_infinite_linear] z-0" />

        {/* Top Meta Strip */}
        <div className="flex items-center justify-between h-5 mb-4 shrink-0 relative z-[1]">
          <div className="flex items-center gap-1.5 text-muted-foreground/60">
            <Fingerprint size={11} className="shrink-0" />
            <span className="label-mono text-[9px] tracking-[0.2em] whitespace-nowrap">
              FILE #{dossierNumber}
            </span>
          </div>

          <div className="h-5 flex items-center">
            {needsReview ? (
              <span className="label-mono text-[9px] tracking-[0.15em] text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5 bg-amber-500/10 flex items-center gap-1 whitespace-nowrap">
                <AlertTriangle size={10} className="shrink-0" /> TO REVIEW
              </span>
            ) : !exported ? (
              <span className="label-mono text-[9px] tracking-[0.15em] text-emerald-300 border border-emerald-500/30 rounded px-1.5 py-0.5 bg-emerald-500/10 whitespace-nowrap">
                QUEUED
              </span>
            ) : (
              <span className="label-mono text-[9px] tracking-[0.15em] text-muted-foreground/50 border border-white/5 rounded px-1.5 py-0.5 whitespace-nowrap">
                EXPORTED
              </span>
            )}
          </div>
        </div>

        {/* Header Verrouillé */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 shrink-0 relative z-[1] min-h-[72px] max-h-[72px] overflow-hidden">
          <div className="min-w-0 flex flex-col justify-between h-full">
            <div className="flex items-center gap-2 min-h-[28px] max-h-[28px] relative">
              <h2
                className="text-xl md:text-2xl font-bold truncate text-white select-all pr-7"
                title={card.word}
              >
                {card.word}
              </h2>
              <button
                onClick={() => speak(card.word)}
                title="Pronounce"
                className="absolute right-0 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-[color:var(--color-gold)] hover:bg-white/5 transition opacity-0 group-hover:opacity-100 shrink-0"
              >
                <Volume2 size={14} />
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground h-4 overflow-hidden whitespace-nowrap truncate">
              {card.ipa && <span className="font-mono truncate">{card.ipa}</span>}
              {card.pos && <span className="truncate">· {card.pos}</span>}
            </div>

            <div className="flex gap-1 mt-1 h-[20px] overflow-hidden whitespace-nowrap">
              {tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-crimson)]/10 text-neutral-300 border border-[var(--color-crimson)]/20 truncate max-w-[80px] inline-block"
                >
                  {t}
                </span>
              ))}
              {tags.length > 2 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-900 text-neutral-400 border border-white/5 font-mono">
                  +{tags.length - 2}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0 self-start">
            {card.level && (
              <div
                className="w-8 h-8 flex items-center justify-center bg-gradient-to-br from-[color:var(--color-gold)]/25 to-[color:var(--color-gold)]/5 border border-[color:var(--color-gold)]/50 text-[color:var(--color-gold)] label-mono text-[9px] font-bold shadow-[0_0_10px_rgba(212,175,55,0.15)] shrink-0"
                style={{
                  clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
                }}
                title={`Level ${card.level}`}
              >
                {card.level}
              </div>
            )}
            {compact && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition shrink-0"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                <ChevronDown
                  size={14}
                  className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                />
              </button>
            )}
          </div>
        </header>

        {/* Corps textuel étanche */}
        <div className="flex-1 flex flex-col justify-start min-h-0 relative z-[1] mt-4">
          {showBody ? (
            <div className="space-y-3.5 overflow-y-auto pr-1 max-h-[220px] custom-scrollbar">
              {card.definition && (
                <section className="pl-3 border-l-2 border-[color:var(--color-crimson)]/40 break-words">
                  <p className="label-mono mb-0.5 text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    DEFINITION
                  </p>
                  <p className="leading-relaxed text-sm text-neutral-200">{card.definition}</p>
                </section>
              )}

              {card.french && (
                <section className="pl-3 border-l-2 border-[color:var(--color-gold)]/40 break-words">
                  <p className="label-mono mb-0.5 text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    FRANÇAIS
                  </p>
                  <p
                    className="text-[color:var(--color-gold)] text-sm"
                    dangerouslySetInnerHTML={{ __html: card.french }}
                  />
                </section>
              )}

              {!compact && card.grammar && (
                <section className="pl-3 border-l-2 border-white/10 break-words">
                  <p className="label-mono mb-0.5 text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    GRAMMAR
                  </p>
                  <div
                    className="text-sm text-neutral-300"
                    dangerouslySetInnerHTML={{ __html: grammarToHtml(card.grammar) }}
                  />
                </section>
              )}

              {card.examples && (
                <section className="pl-3 border-l-2 border-white/10 break-words">
                  <p className="label-mono mb-0.5 text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    EXAMPLES
                  </p>
                  <div
                    className="text-sm text-neutral-300 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: examplesToHtml(card.examples) }}
                  />
                </section>
              )}

              {!compact && card.cloze && (
                <section className="pl-3 border-l-2 border-[color:var(--color-crimson)]/20 break-words">
                  <p className="label-mono mb-0.5 text-[9px] tracking-[0.15em] text-muted-foreground/60 select-none">
                    CLOZE
                  </p>
                  <div
                    className="text-sm text-neutral-300"
                    dangerouslySetInnerHTML={{ __html: clozeToHtml(card.cloze) }}
                  />
                </section>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-[40px]" />
          )}
        </div>

        {/* Barre d'Actions d'icônes Mathématique et Ultra-Stable */}
        <div className="mt-auto pt-3 shrink-0 relative z-[1] border-t border-white/5">
          <div className="flex items-center justify-between h-8 min-h-[32px] max-h-[32px]">
            {/* Action principale : Full Lesson Toujours visible à gauche */}
            <button
              onClick={() => setOpenLesson(true)}
              className="h-full bg-[var(--color-crimson)]/10 hover:bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/30 text-white font-medium rounded-md px-3 text-xs flex items-center gap-1.5 transition shrink-0"
            >
              <Book size={13} />
              <span>Full lesson</span>
            </button>

            {/* Matrice d'actions iconographiques à droite à largeur fixe */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Bouton File / Export Iconisé */}
              <button
                onClick={toggleExport}
                title={!exported ? "Remove from export queue" : "Add to export queue"}
                className={`p-1.5 h-8 w-8 rounded-md flex items-center justify-center border transition ${
                  !exported
                    ? "border-[color:var(--color-gold)]/40 text-[color:var(--color-gold)] bg-[color:var(--color-gold)]/10"
                    : "border-white/5 text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                {!exported ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
              </button>

              {/* Bouton Marquer révisé Iconisé */}
              {needsReview && (
                <button
                  onClick={markReviewed}
                  title="Mark as reviewed"
                  className="p-1.5 h-8 w-8 rounded-md flex items-center justify-center border border-amber-500/30 text-amber-400 bg-amber-500/5 hover:bg-amber-500/10 transition"
                >
                  <Check size={14} />
                </button>
              )}

              {/* Bouton Supprimer Iconisé */}
              {onDelete && (
                <button
                  onClick={handleConfirmDelete}
                  title="Delete card"
                  className="p-1.5 h-8 w-8 rounded-md flex items-center justify-center text-neutral-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/10 transition"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Section Interne Basse (Tags) */}
          {!compact && (
            <div className="pt-3 mt-3 border-t border-white/5 space-y-2">
              <div className="flex flex-wrap gap-1 max-h-[52px] overflow-y-auto pr-0.5 custom-scrollbar">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-white/5 border border-white/10 text-neutral-200 whitespace-nowrap"
                  >
                    {t}
                    <button
                      onClick={() => toggleTag(t)}
                      className="hover:text-red-400 transition-colors shrink-0"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {SUGGESTED_TAGS.filter((s) => !tags.includes(s)).map((s) => (
                  <button
                    key={s}
                    onClick={() => toggleTag(s)}
                    className="text-[11px] px-2 py-0.5 rounded border border-dashed border-white/10 text-muted-foreground hover:text-white hover:border-white/20 transition whitespace-nowrap"
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
                className="flex gap-1 pt-0.5"
              >
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="Add a tag..."
                  className="flex-1 bg-black/40 border border-white/5 text-xs px-2.5 py-1.5 rounded-md focus:outline-none focus:border-[var(--color-crimson)] text-white placeholder-neutral-600"
                  maxLength={30}
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-xs border border-white/5 text-white transition-colors shrink-0"
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
