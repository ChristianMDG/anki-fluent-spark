import { useState } from "react";
import {
  Book,
  Plus,
  Check,
  Trash2,
  Volume2,
  AlertTriangle,
  X,
  Fingerprint,
  Bookmark,
  BookmarkCheck,
  RotateCcw,
  Eye,
  Flag,
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
  layout = "grid",
  onDelete,
}: {
  card: CardRow;
  compact?: boolean;
  layout?: "grid" | "sidebar";
  onDelete?: () => void;
}) {
  const [openLesson, setOpenLesson] = useState(false);
  const [exported, setExported] = useState(card.exported);
  // Anki-style front/back: compact cards (grid/library view) start on the
  // Front (word only, for recall practice) and flip to reveal the Back.
  // Non-compact cards (a focused single-card view) start already flipped,
  // matching the previous "always expanded" behavior in that context.
  const [flipped, setFlipped] = useState(!compact);
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

  async function toggleNeedsReview() {
    const next = !needsReview;
    setNeedsReview(next);
    const { error } = await supabase
      .from("cards")
      .update({ needs_review: next })
      .eq("id", card.id);
    if (error) {
      setNeedsReview(!next);
      return toast.error(error.message);
    }
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success(next ? "Flagged for review" : "Marked as reviewed");
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

  const dossierNumber = card.id.replace(/-/g, "").slice(0, 6).toUpperCase();
  const cardSize =
    layout === "sidebar"
      ? "w-full min-h-0 max-h-none h-[clamp(500px,125cqi,560px)]"
      : "w-full min-h-[440px] max-h-[560px]";

  const statusBadge = needsReview ? (
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
  );

  return (
    <>
      {/* Flip container: perspective on the wrapper, rotateY on the inner
          card, backface-visibility:hidden on each face. Only the active
          face is interactive/visible; the other is rotated away and hidden.
          Falls back to an instant swap (no 3D animation) for
          prefers-reduced-motion via the motion-reduce: variants. */}
      <div
        className={`relative ${cardSize} [perspective:1600px] ${
          needsReview ? "" : ""
        }`}
      >
        <div
          className={`relative w-full h-full transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none motion-reduce:duration-0 ${
            flipped ? "[transform:rotateY(180deg)]" : ""
          }`}
        >
          {/* ---------------- FRONT ---------------- */}
          <article
            aria-hidden={flipped}
            className={`absolute inset-0 flex flex-col glass-panel p-5 group overflow-hidden [backface-visibility:hidden] ${
              flipped ? "pointer-events-none" : "pointer-events-auto"
            } ${
              needsReview ? "!border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]" : ""
            }`}
          >
            <div className="pointer-events-none absolute inset-x-0 h-[1px] bg-[var(--color-crimson)]/25 opacity-0 group-hover:opacity-100 group-hover:animate-[scanline_2.4s_infinite_linear] z-0" />

            <div className="flex items-center justify-between h-5 mb-4 shrink-0 relative z-[1]">
              <div className="flex items-center gap-1.5 text-muted-foreground/60">
                <Fingerprint size={11} className="shrink-0" />
                <span className="label-mono text-[9px] tracking-[0.2em] whitespace-nowrap">
                  FILE #{dossierNumber}
                </span>
              </div>
              <div className="h-5 flex items-center">{statusBadge}</div>
            </div>

            <button
              type="button"
              onClick={() => setFlipped(true)}
              className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0 relative z-[1] text-center"
              aria-label={`Reveal the answer for ${card.word}`}
            >
              {card.level && (
                <div
                  className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-[color:var(--color-gold)]/25 to-[color:var(--color-gold)]/5 border border-[color:var(--color-gold)]/50 text-[color:var(--color-gold)] label-mono text-[10px] font-bold shadow-[0_0_10px_rgba(212,175,55,0.15)]"
                  style={{
                    clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
                  }}
                  title={`Level ${card.level}`}
                >
                  {card.level}
                </div>
              )}

              <div className="min-w-0 max-w-full">
                <h2 className="text-2xl md:text-3xl font-bold text-white break-words">
                  {card.word}
                </h2>
                <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-2">
                  {card.ipa && <span className="font-mono">{card.ipa}</span>}
                  {card.pos && <span>· {card.pos}</span>}
                </div>
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1 max-w-full">
                  {tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-crimson)]/10 text-neutral-300 border border-[var(--color-crimson)]/20 truncate max-w-[90px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <span className="label-mono text-[10px] tracking-[0.2em] text-muted-foreground/50 flex items-center gap-1.5 mt-2">
                <Eye size={12} /> Tap to reveal
              </span>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                speak(card.word);
              }}
              title="Pronounce"
              className="absolute top-12 right-5 p-1.5 rounded-md text-muted-foreground hover:text-[color:var(--color-gold)] hover:bg-white/5 transition z-[2]"
            >
              <Volume2 size={14} />
            </button>
          </article>

          {/* ---------------- BACK ---------------- */}
          <article
            aria-hidden={!flipped}
            className={`absolute inset-0 flex flex-col glass-panel p-5 group overflow-hidden [backface-visibility:hidden] [transform:rotateY(180deg)] ${
              flipped ? "pointer-events-auto" : "pointer-events-none"
            } ${
              needsReview ? "!border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15)]" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-3 shrink-0 relative z-[1] mb-3">
              <div className="min-w-0 flex items-center gap-2">
                <h3 className="text-lg font-bold text-white truncate" title={card.word}>
                  {card.word}
                </h3>
                {card.level && (
                  <span className="label-mono text-[9px] text-[color:var(--color-gold)] border border-[color:var(--color-gold)]/40 rounded px-1.5 py-0.5 shrink-0">
                    {card.level}
                  </span>
                )}
              </div>
              <button
                onClick={() => setFlipped(false)}
                title="Back to word"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition shrink-0 flex items-center gap-1"
              >
                <RotateCcw size={13} />
                <span className="label-mono text-[9px]">FRONT</span>
              </button>
            </div>

            <div className="flex-1 flex flex-col justify-start min-h-0 relative z-[1]">
              <div className="space-y-3.5 overflow-y-auto pr-1 max-h-[280px] custom-scrollbar">
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
            </div>

            <div className="mt-auto pt-3 shrink-0 relative z-[1] border-t border-white/5">
              <div className="flex items-center justify-between h-8 min-h-[32px] max-h-[32px]">
                <button
                  onClick={() => setOpenLesson(true)}
                  className="h-full bg-[var(--color-crimson)]/10 hover:bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/30 text-white font-medium rounded-md px-3 text-xs flex items-center gap-1.5 transition shrink-0"
                >
                  <Book size={13} />
                  <span>Full lesson</span>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
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

                  <button
                    onClick={toggleNeedsReview}
                    title={needsReview ? "Mark as reviewed" : "Flag for review"}
                    className={`p-1.5 h-8 w-8 rounded-md flex items-center justify-center border transition ${
                      needsReview
                        ? "border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                        : "border-white/5 text-muted-foreground hover:text-amber-400 hover:border-amber-500/30 hover:bg-amber-500/5"
                    }`}
                  >
                    {needsReview ? <Check size={14} /> : <Flag size={14} />}
                  </button>

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
        </div>
      </div>

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