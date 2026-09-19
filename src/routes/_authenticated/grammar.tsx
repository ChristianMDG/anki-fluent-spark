import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { CardRow } from "@/components/VocabCard";
import { parseClozeItems } from "@/lib/cloze-parser";
import {
  generateUsageChoice,
  generateErrorCorrection,
  checkCorrection,
  generateTransformation,
  checkTransformation,
  generateDailyContext,
  generateMultiWordContext,
  evaluateFreeSentence,
  evaluateFreeParagraph,
  extractGrammarPattern,
  type HighlightedSegment,
} from "@/lib/grammar.functions";
import {
  CEFR_LEVELS,
  type CefrLevel,
  type LearnerProfile,
} from "@/integrations/supabase/learner-profile.types";
import {
  Pencil,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Sparkles,
  Loader2,
  ArrowRight,
  Library,
  HelpCircle,
  AlertTriangle,
  Send,
  BookOpen,
  Check,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/grammar")({
  validateSearch: () => ({}),
  component: GrammarPage,
});

type ExerciseType =
  | "fill_in_blank"
  | "usage_choice"
  | "error_correction"
  | "sentence_transformation"
  | "free_construction";
type SessionLength = 5 | 10 | 15;

const EXERCISE_NAMES: Record<ExerciseType, string> = {
  fill_in_blank: "Fill in the Blank",
  usage_choice: "Usage Choice",
  error_correction: "Error Correction",
  sentence_transformation: "Sentence Transformation",
  free_construction: "Free Construction",
};

interface ExerciseItem {
  card: CardRow;
  type: ExerciseType;
  extraCards?: CardRow[];
  focusPattern?: string;
}

interface ScoreTracker {
  fill_in_blank: { correct: number; total: number };
  usage_choice: { correct: number; total: number };
  error_correction: { correct: number; total: number };
  sentence_transformation: { correct: number; total: number };
  free_construction: { reviewed: number };
}

interface GrammarErrorPattern {
  id: string;
  pattern_tag: string;
  occurrences: number;
  last_seen_at: string;
  resolved: boolean;
}

// Helper to shuffle an array
function shuffleArray<T>(arr: T[]): T[] {
  const c = [...arr];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

// ---------------------------------------------------------------------------
// Learner profile hook
// ---------------------------------------------------------------------------

function useLearnerProfile() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["learner-profile"],
    queryFn: async (): Promise<LearnerProfile> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      try {
        await (
          supabase.rpc as unknown as (
            fn: string,
            args: { _user: string },
          ) => Promise<unknown>
        )("ensure_learner_profile", { _user: user.id });
      } catch {
        /* ignore */
      }

      try {
        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, val: string) => {
                single: () => Promise<{ data: LearnerProfile | null; error: unknown }>;
              };
            };
          };
        })
          .from("learner_profile")
          .select("*")
          .eq("user_id", user.id)
          .single();

        if (error) {
          return {
            id: "",
            user_id: user.id,
            current_level: "B1",
            created_at: new Date().toISOString(),
          };
        }

        return (data as LearnerProfile | null) ?? {
          id: "",
          user_id: user.id,
          current_level: "B1",
          created_at: new Date().toISOString(),
        };
      } catch {
        return {
          id: "",
          user_id: user.id,
          current_level: "B1",
          created_at: new Date().toISOString(),
        };
      }
    },
    staleTime: 30_000,
  });

  const setLevel = useCallback(
    async (level: CefrLevel) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const now = new Date().toISOString();
      await (supabase as unknown as {
        from: (t: string) => {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        };
      })
        .from("learner_profile")
        .update({
          current_level: level,
          level_updated_at: now,
          updated_at: now,
        })
        .eq("user_id", user.id);

      qc.invalidateQueries({ queryKey: ["learner-profile"] });
    },
    [qc],
  );

  return { profile: query.data, setLevel, isLoading: query.isLoading };
}

// ---------------------------------------------------------------------------
// Error Highlighting Component
// ---------------------------------------------------------------------------

function RenderHighlightedAnswer({ segments }: { segments?: HighlightedSegment[] }) {
  if (!segments || segments.length === 0) return null;
  return (
    <div className="p-3.5 rounded-xl bg-black/50 border border-white/10 text-xs leading-relaxed space-y-1 mt-2">
      <span className="text-[10px] label-mono text-neutral-400 block uppercase tracking-wider">
        Your Response Error Analysis:
      </span>
      <div className="text-sm font-medium">
        {segments.map((seg, idx) =>
          seg.isError ? (
            <mark
              key={idx}
              className="bg-red-500/25 text-red-200 border-b-2 border-red-500 font-semibold px-1 py-0.5 rounded-sm mx-0.5"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={idx}>{seg.text}</span>
          ),
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component Page
// ---------------------------------------------------------------------------

function GrammarPage() {
  const [phase, setPhase] = useState<"entry" | "session" | "summary">("entry");
  const [sessionLength, setSessionLength] = useState<SessionLength>(5);
  const [exerciseQueue, setExerciseQueue] = useState<ExerciseItem[]>([]);
  const [step, setStep] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  const [scores, setScores] = useState<ScoreTracker>({
    fill_in_blank: { correct: 0, total: 0 },
    usage_choice: { correct: 0, total: 0 },
    error_correction: { correct: 0, total: 0 },
    sentence_transformation: { correct: 0, total: 0 },
    free_construction: { reviewed: 0 },
  });

  const qc = useQueryClient();
  const { profile, setLevel, isLoading: profileLoading } = useLearnerProfile();
  const cefrLevel = profile?.current_level ?? "B1";

  // Query top unresolved error patterns
  const { data: topErrorPatterns = [] } = useQuery({
    queryKey: ["grammar-error-patterns"],
    queryFn: async (): Promise<GrammarErrorPattern[]> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              eq: (col: string, val: boolean) => {
                order: (col: string, opts: Record<string, unknown>) => {
                  order: (col: string, opts: Record<string, unknown>) => {
                    limit: (n: number) => Promise<{ data: GrammarErrorPattern[] | null; error: unknown }>;
                  };
                };
              };
            };
          };
        };
      })
        .from("grammar_error_patterns")
        .select("*")
        .eq("user_id", user.id)
        .eq("resolved", false)
        .order("occurrences", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(2);

      if (error) return [];
      return (data as GrammarErrorPattern[]) ?? [];
    },
    staleTime: 10_000,
  });

  // Query words ready for grammar practice
  const { data: readyCount = 0, isLoading: countLoading } = useQuery({
    queryKey: ["cards", "grammar-ready-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true });
      if (error) return 0;
      return count ?? 0;
    },
  });

  async function handleResolvePattern(id: string) {
    await (supabase as unknown as {
      from: (t: string) => {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    })
      .from("grammar_error_patterns")
      .update({ resolved: true })
      .eq("id", id);

    qc.invalidateQueries({ queryKey: ["grammar-error-patterns"] });
    toast.success("Marked error pattern as resolved!");
  }

  async function handleStartSession() {
    setIsStarting(true);
    try {
      // Prioritize: needs_review = true cards first, then least-recently-drilled cards (nulls first), then created_at desc
      const db = supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            order: (col: string, opts?: Record<string, unknown>) => {
              order: (col: string, opts?: Record<string, unknown>) => {
                order: (col: string, opts?: Record<string, unknown>) => {
                  limit: (n: number) => Promise<{ data: CardRow[] | null; error: { message: string } | null }>;
                };
              };
            };
          };
        };
      };
      const { data: cardsData, error } = await db
        .from("cards")
        .select("*")
        .order("needs_review", { ascending: false })
        .order("last_grammar_drill_at", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(sessionLength);

      if (error) throw error;
      if (!cardsData || cardsData.length === 0) {
        toast.error("No vocabulary cards available. Generate some cards first!");
        setIsStarting(false);
        return;
      }

      const cards = cardsData as CardRow[];
      const typesRotation: ExerciseType[] = [
        "fill_in_blank",
        "usage_choice",
        "error_correction",
        "sentence_transformation",
        "free_construction",
      ];

      const focusPattern = topErrorPatterns[0]?.pattern_tag;

      const queue: ExerciseItem[] = cards.map((card, idx) => {
        const type = typesRotation[idx % typesRotation.length];
        let extraCards: CardRow[] | undefined;

        // Occasional mini-paragraph turn for free_construction (e.g. 4th item or if cards available)
        if (type === "free_construction" && (idx % 3 === 0 || cards.length >= 3)) {
          const pool = cards.filter((c) => c.id !== card.id);
          if (pool.length >= 1) {
            extraCards = pool.slice(0, Math.min(2, pool.length));
          }
        }

        return {
          card,
          type,
          extraCards,
          focusPattern,
        };
      });

      setExerciseQueue(queue);
      setStep(0);
      setScores({
        fill_in_blank: { correct: 0, total: 0 },
        usage_choice: { correct: 0, total: 0 },
        error_correction: { correct: 0, total: 0 },
        sentence_transformation: { correct: 0, total: 0 },
        free_construction: { reviewed: 0 },
      });
      setPhase("session");
    } catch (err) {
      toast.error("Failed to start grammar session: " + (err as Error).message);
    } finally {
      setIsStarting(false);
    }
  }

  function handleExerciseResult(type: ExerciseType, isCorrect: boolean) {
    setScores((prev) => {
      const next = { ...prev };
      if (type === "free_construction") {
        next.free_construction = { reviewed: next.free_construction.reviewed + 1 };
      } else {
        const cur = next[type];
        next[type] = {
          correct: cur.correct + (isCorrect ? 1 : 0),
          total: cur.total + 1,
        };
      }
      return next;
    });
  }

  async function handleNextExercise(item: ExerciseItem, isCorrect: boolean) {
    // 1. Update last_grammar_drill_at timestamp
    const nowIso = new Date().toISOString();
    await (supabase as unknown as {
      from: (table: string) => {
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<unknown>;
        };
      };
    })
      .from("cards")
      .update({ last_grammar_drill_at: nowIso })
      .eq("id", item.card.id);

    // 2. If incorrect, mark needs_review = true
    if (!isCorrect) {
      await supabase
        .from("cards")
        .update({ needs_review: true })
        .eq("id", item.card.id);
    }

    qc.invalidateQueries({ queryKey: ["cards"] });

    // Advance queue
    if (step + 1 < exerciseQueue.length) {
      setStep((s) => s + 1);
    } else {
      setPhase("summary");
    }
  }

  // ---------------------------------------------------------------------------
  // Entry View
  // ---------------------------------------------------------------------------
  if (phase === "entry") {
    return (
      <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 label-mono text-[color:var(--color-gold)]">
            <Pencil size={16} /> Grammar Practice
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mt-1">Master your vocabulary in context.</h1>
          <p className="text-muted-foreground mt-2 max-w-xl">
            A focused exercise system designed to turn passive words into active language skills.
            Practice realistic daily-life usage through 5 guided exercise types and mini-paragraph challenges.
          </p>
        </div>

        {/* Error Pattern Coaching Banner (if any unresolved patterns exist) */}
        {topErrorPatterns.length > 0 && (
          <div className="glass-panel p-5 border-l-4 border-l-amber-500 bg-amber-950/20 backdrop-blur-md border border-amber-500/30 rounded-2xl space-y-3 shadow-lg">
            <div className="flex items-center gap-2 text-amber-400 font-audiowide text-xs uppercase tracking-wider">
              <Zap size={15} /> Working On Target Grammar Patterns
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {topErrorPatterns.map((pat) => (
                <div
                  key={pat.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/40 border border-amber-500/40 text-xs text-neutral-200"
                >
                  <span>
                    Focus: <strong className="text-amber-300 font-semibold">{pat.pattern_tag}</strong>{" "}
                    <span className="text-[10px] text-neutral-400">({pat.occurrences}×)</span>
                  </span>
                  <button
                    onClick={() => handleResolvePattern(pat.id)}
                    className="ml-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-0.5 rounded-lg border border-emerald-500/30 transition flex items-center gap-1"
                    title="Mark as resolved"
                  >
                    <Check size={12} /> Resolved
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Level & Readiness Panel */}
        <div className="glass-panel p-6 md:p-8 space-y-6">
          {/* Level Selector */}
          <div>
            <p className="label-mono mb-2">Target CEFR Level</p>
            {profileLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Loading profile…
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {CEFR_LEVELS.map((lvl) => {
                  const active = cefrLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      onClick={() => setLevel(lvl)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                        active
                          ? "border border-[color:var(--color-crimson-glow)] bg-[color:var(--color-crimson)]/20 text-white shadow-[0_0_15px_rgba(237,28,36,0.3)] scale-105"
                          : "border border-[color:var(--color-border)] text-muted-foreground hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-white/5 pt-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="label-mono">Cards Ready For Practice</p>
              <div className="text-3xl font-black mt-1 text-white flex items-center gap-2">
                {countLoading ? (
                  <Loader2 size={20} className="animate-spin text-muted-foreground" />
                ) : (
                  <span>{readyCount}</span>
                )}
                <span className="text-sm font-normal text-neutral-400">words in total pool</span>
              </div>
            </div>

            <div className="text-right">
              <p className="label-mono">Exercise Variety</p>
              <p className="text-xs text-neutral-400 mt-1">5 rotating exercise types + mini-paragraphs</p>
            </div>
          </div>
        </div>

        {/* Session Length Pills */}
        <div className="space-y-3">
          <p className="label-mono">Select Session Length</p>
          <div className="grid grid-cols-3 gap-3">
            {([5, 10, 15] as SessionLength[]).map((n) => {
              const active = sessionLength === n;
              return (
                <button
                  key={n}
                  onClick={() => setSessionLength(n)}
                  className={`glass-panel p-4 text-center transition ${
                    active
                      ? "border-[color:var(--color-crimson-glow)] bg-[color:var(--color-crimson)]/15 -translate-y-0.5 shadow-[0_0_20px_rgba(237,28,36,0.2)]"
                      : "hover:-translate-y-0.5 hover:border-white/20"
                  }`}
                >
                  <div className="font-audiowide text-2xl font-bold text-white">{n}</div>
                  <div className="text-[10px] label-mono text-neutral-400 uppercase mt-0.5">
                    {n} Words
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Start Button */}
        <div className="pt-2">
          <button
            onClick={handleStartSession}
            disabled={isStarting || readyCount === 0}
            className="w-full btn-crimson rounded-2xl py-4 font-audiowide text-sm tracking-widest uppercase flex items-center justify-center gap-3 shadow-[0_4px_25px_rgba(237,28,36,0.3)] disabled:opacity-50 transition-all duration-300"
          >
            {isStarting ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Starting Session…
              </>
            ) : (
              <>
                <Sparkles size={18} /> Start Grammar Session ({sessionLength} Words)
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Session View
  // ---------------------------------------------------------------------------
  if (phase === "session" && exerciseQueue.length > 0) {
    const currentItem = exerciseQueue[step];
    if (!currentItem) return null;

    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
        {/* Header HUD */}
        <div className="flex items-center justify-between glass-panel px-5 py-3.5 rounded-2xl bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 shadow-lg">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPhase("entry")}
              className="text-neutral-400 hover:text-white transition mr-2"
              title="Exit Session"
            >
              <RotateCcw size={16} />
            </button>
            <span className="font-audiowide text-xs font-bold uppercase tracking-wider text-[var(--color-gold)]">
              {currentItem.extraCards
                ? "Mini-Paragraph Challenge"
                : EXERCISE_NAMES[currentItem.type]}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="label-mono text-xs text-neutral-300">
              Item <span className="text-white font-bold">{step + 1}</span> of {exerciseQueue.length}
            </span>
            <div className="w-20 bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="bg-[var(--color-crimson)] h-full transition-all duration-300"
                style={{ width: `${((step + 1) / exerciseQueue.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Exercise Runner Component */}
        <ExerciseRunner
          key={`${currentItem.card.id}-${step}`}
          item={currentItem}
          cefrLevel={cefrLevel}
          onResult={(isCorrect) => handleExerciseResult(currentItem.type, isCorrect)}
          onNext={(isCorrect) => handleNextExercise(currentItem, isCorrect)}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Summary View
  // ---------------------------------------------------------------------------
  if (phase === "summary") {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="glass-panel p-8 md:p-10 text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/40 flex items-center justify-center text-[var(--color-crimson)] shadow-[0_0_30px_rgba(237,28,36,0.3)]">
            <CheckCircle2 size={36} />
          </div>

          <div className="space-y-2">
            <p className="label-mono text-[var(--color-gold)]">Session Finished</p>
            <h1 className="font-audiowide text-3xl font-black uppercase text-white tracking-tight">
              Grammar Drill Complete
            </h1>
            <p className="text-neutral-400 text-sm max-w-md mx-auto">
              Great work! You completed {exerciseQueue.length} vocabulary grammar exercises.
            </p>
          </div>

          {/* Breakdown Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 pt-2 text-left">
            <SummaryTypeCard
              label="Fill Blank"
              correct={scores.fill_in_blank.correct}
              total={scores.fill_in_blank.total}
            />
            <SummaryTypeCard
              label="Choice"
              correct={scores.usage_choice.correct}
              total={scores.usage_choice.total}
            />
            <SummaryTypeCard
              label="Correct"
              correct={scores.error_correction.correct}
              total={scores.error_correction.total}
            />
            <SummaryTypeCard
              label="Transform"
              correct={scores.sentence_transformation.correct}
              total={scores.sentence_transformation.total}
            />
            <div className="glass-panel p-3.5 rounded-xl border border-white/10 space-y-1">
              <p className="label-mono text-[9px] text-neutral-400 uppercase">Free Build</p>
              <div className="text-lg font-black text-white">
                {scores.free_construction.reviewed} <span className="text-xs font-normal text-neutral-400">done</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <button
              onClick={() => setPhase("entry")}
              className="w-full sm:w-auto btn-crimson font-audiowide text-xs tracking-widest uppercase flex items-center justify-center gap-2 rounded-xl px-6 py-3 shadow-[0_4px_20px_rgba(237,28,36,0.2)] transition-all duration-300"
            >
              <RotateCcw size={16} />
              <span>Start New Session</span>
            </button>
            <Link
              to="/library"
              className="w-full sm:w-auto font-audiowide text-xs tracking-widest uppercase flex items-center justify-center gap-2 rounded-xl px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white transition-all duration-300"
            >
              <Library size={16} />
              <span>View Library</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function SummaryTypeCard({ label, correct, total }: { label: string; correct: number; total: number }) {
  if (total === 0) {
    return (
      <div className="glass-panel p-3.5 rounded-xl border border-white/10 space-y-1 opacity-60">
        <p className="label-mono text-[9px] text-neutral-400 uppercase">{label}</p>
        <div className="text-lg font-black text-neutral-400">—</div>
      </div>
    );
  }
  const pct = Math.round((correct / total) * 100);
  return (
    <div className="glass-panel p-3.5 rounded-xl border border-white/10 space-y-1">
      <p className="label-mono text-[9px] text-neutral-400 uppercase">{label}</p>
      <div className="text-lg font-black text-white">
        {correct}/{total} <span className="text-[10px] font-mono text-[var(--color-gold)]">({pct}%)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single Exercise Runner
// ---------------------------------------------------------------------------

function ExerciseRunner({
  item,
  cefrLevel,
  onResult,
  onNext,
}: {
  item: ExerciseItem;
  cefrLevel: CefrLevel;
  onResult: (isCorrect: boolean) => void;
  onNext: (isCorrect: boolean) => void;
}) {
  const { card, type, extraCards, focusPattern } = item;
  const allCards = [card, ...(extraCards ?? [])];

  return (
    <div className="glass-panel p-6 md:p-8 space-y-6">
      {/* Target Word Header Banner */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <span className="label-mono text-[9px] text-neutral-400 uppercase">
            {allCards.length > 1 ? "Target Vocabulary Words" : "Target Word"}
          </span>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {allCards.map((c) => (
              <span key={c.id} className="text-xl md:text-2xl font-bold text-white">
                {c.word}
              </span>
            ))}
          </div>
        </div>
        <div className="text-right">
          {card.level && (
            <span className="label-mono text-[10px] text-[var(--color-gold)] border border-[var(--color-gold)]/40 rounded-md px-2 py-0.5">
              Level {card.level}
            </span>
          )}
          {card.definition && (
            <p className="text-xs text-neutral-400 max-w-[220px] truncate mt-1" title={card.definition}>
              {card.definition}
            </p>
          )}
        </div>
      </div>

      {/* Render Specific Exercise Mechanics */}
      {type === "fill_in_blank" && (
        <FillInBlankExercise card={card} onResult={onResult} onNext={onNext} />
      )}
      {type === "usage_choice" && (
        <UsageChoiceExercise
          card={card}
          cefrLevel={cefrLevel}
          focusPattern={focusPattern}
          onResult={onResult}
          onNext={onNext}
        />
      )}
      {type === "error_correction" && (
        <ErrorCorrectionExercise
          card={card}
          cefrLevel={cefrLevel}
          focusPattern={focusPattern}
          onResult={onResult}
          onNext={onNext}
        />
      )}
      {type === "sentence_transformation" && (
        <SentenceTransformationExercise
          card={card}
          cefrLevel={cefrLevel}
          focusPattern={focusPattern}
          onResult={onResult}
          onNext={onNext}
        />
      )}
      {type === "free_construction" && (
        <FreeConstructionExercise
          card={card}
          extraCards={extraCards}
          cefrLevel={cefrLevel}
          focusPattern={focusPattern}
          onResult={onResult}
          onNext={onNext}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercise 1: Fill In Blank
// ---------------------------------------------------------------------------

function FillInBlankExercise({
  card,
  onResult,
  onNext,
}: {
  card: CardRow;
  onResult: (isCorrect: boolean) => void;
  onNext: (isCorrect: boolean) => void;
}) {
  const [inputVal, setInputVal] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  const clozeItems = useMemo(() => parseClozeItems(card.cloze, card.word), [card.cloze, card.word]);
  const activeItem = clozeItems[0];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputVal.trim() || submitted) return;

    const trimmedInput = inputVal.trim().toLowerCase();
    const expected = activeItem.answer.trim().toLowerCase();
    const targetWord = card.word.trim().toLowerCase();

    // Accept either exact answer match or card word match
    const correct = trimmedInput === expected || trimmedInput === targetWord;
    setIsCorrect(correct);
    setSubmitted(true);
    onResult(correct);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="label-mono text-xs text-[var(--color-gold)]">
          Complete the sentence with the missing word:
        </p>
        <div className="glass-panel-soft p-5 rounded-xl text-lg font-medium text-neutral-100 leading-relaxed">
          {activeItem.sentence}
        </div>
      </div>

      {!submitted ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder="Type the missing word…"
              className="w-full glass-panel-soft px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-crimson)] text-white placeholder-neutral-500 font-medium"
              autoFocus
              autoComplete="off"
            />
          </div>
          <button
            type="submit"
            disabled={!inputVal.trim()}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <span>Submit Answer</span>
            <Send size={14} />
          </button>
        </form>
      ) : (
        <div className="space-y-5 animate-in fade-in duration-300">
          <div
            className={`p-4 rounded-xl border flex items-start gap-3 ${
              isCorrect
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                : "bg-red-950/40 border-red-500/40 text-red-200"
            }`}
          >
            {isCorrect ? (
              <CheckCircle2 size={22} className="text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle size={22} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p className="font-bold text-sm">
                {isCorrect ? "Correct!" : "Not quite right"}
              </p>
              <p className="text-xs opacity-90">
                {!isCorrect && (
                  <>
                    Expected answer: <strong className="text-white">{activeItem.answer}</strong> (or{" "}
                    <strong className="text-white">{card.word}</strong>)
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={() => onNext(isCorrect)}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <span>Next Word</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercise 2: Usage Choice
// ---------------------------------------------------------------------------

function UsageChoiceExercise({
  card,
  cefrLevel,
  focusPattern,
  onResult,
  onNext,
}: {
  card: CardRow;
  cefrLevel: CefrLevel;
  focusPattern?: string;
  onResult: (isCorrect: boolean) => void;
  onNext: (isCorrect: boolean) => void;
}) {
  const getChoiceFn = useServerFn(generateUsageChoice);
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<
    { text: string; correct: boolean; whyWrong?: string }[]
  >([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadOptions() {
      setLoading(true);
      try {
        const res = await getChoiceFn({
          data: {
            word: card.word,
            definition: card.definition ?? "",
            level: cefrLevel,
            focusPattern,
          },
        });
        if (active) {
          setOptions(shuffleArray(res.sentences));
        }
      } catch (err) {
        if (active) {
          setOptions([
            { text: `She tried to ${card.word} the issue.`, correct: true, whyWrong: "" },
            { text: `She tried to ${card.word} about the issue.`, correct: false, whyWrong: "Wrong preposition used." },
            { text: `She was ${card.word}ing for the issue.`, correct: false, whyWrong: "Awkward grammatical phrasing." },
          ]);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadOptions();
    return () => {
      active = false;
    };
  }, [card.word, card.definition, cefrLevel, focusPattern, getChoiceFn]);

  function handleSelect(idx: number) {
    if (submitted) return;
    setSelectedIndex(idx);
    setSubmitted(true);
    const chosen = options[idx];
    const correct = chosen?.correct ?? false;
    onResult(correct);
  }

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 size={24} className="animate-spin text-[var(--color-crimson)]" />
        <p className="text-xs label-mono uppercase">AI is crafting realistic usage scenarios…</p>
      </div>
    );
  }

  const isCorrect = selectedIndex !== null ? options[selectedIndex]?.correct ?? false : false;

  return (
    <div className="space-y-6">
      <div>
        <p className="label-mono text-xs text-[var(--color-gold)]">
          Which sentence uses "{card.word}" correctly?
        </p>
        <p className="text-xs text-neutral-400 mt-1">
          Two of these options contain common mistakes a learner might make. Pick the correct one:
        </p>
      </div>

      <div className="space-y-3">
        {options.map((opt, idx) => {
          const isSelected = selectedIndex === idx;
          let btnStyle = "border-white/10 hover:border-white/30 hover:bg-white/5";

          if (submitted) {
            if (opt.correct) {
              btnStyle = "border-emerald-500/60 bg-emerald-950/30 text-emerald-100 shadow-[0_0_15px_rgba(16,185,129,0.2)]";
            } else if (isSelected && !opt.correct) {
              btnStyle = "border-red-500/60 bg-red-950/30 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.2)]";
            } else {
              btnStyle = "border-white/5 opacity-50";
            }
          }

          return (
            <div key={idx} className="space-y-1.5">
              <button
                disabled={submitted}
                onClick={() => handleSelect(idx)}
                className={`w-full text-left glass-panel-soft p-4 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center justify-between gap-3 ${btnStyle}`}
              >
                <span>{opt.text}</span>
                {submitted && opt.correct && (
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                )}
                {submitted && isSelected && !opt.correct && (
                  <XCircle size={18} className="text-red-400 shrink-0" />
                )}
              </button>

              {submitted && !opt.correct && opt.whyWrong && (
                <p className="text-xs text-amber-300/90 pl-3 flex items-center gap-1.5">
                  <HelpCircle size={12} className="shrink-0 text-amber-400" />
                  <span>{opt.whyWrong}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      {submitted && (
        <div className="pt-2 animate-in fade-in duration-300">
          <button
            onClick={() => onNext(isCorrect)}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <span>Next Exercise</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercise 3: Error Correction
// ---------------------------------------------------------------------------

function ErrorCorrectionExercise({
  card,
  cefrLevel,
  focusPattern,
  onResult,
  onNext,
}: {
  card: CardRow;
  cefrLevel: CefrLevel;
  focusPattern?: string;
  onResult: (isCorrect: boolean) => void;
  onNext: (isCorrect: boolean) => void;
}) {
  const getErrorFn = useServerFn(generateErrorCorrection);
  const checkCorrectionFn = useServerFn(checkCorrection);
  const extractPatternFn = useServerFn(extractGrammarPattern);

  const [loading, setLoading] = useState(true);
  const [exerciseData, setExerciseData] = useState<{
    incorrectSentence: string;
    correctSentence: string;
    errorType: string;
  } | null>(null);

  const [learnerAnswer, setLearnerAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [evaluation, setEvaluation] = useState<{
    isCorrect: boolean;
    feedback: string;
    highlightedAnswer?: HighlightedSegment[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchExercise() {
      setLoading(true);
      try {
        const res = await getErrorFn({
          data: {
            word: card.word,
            definition: card.definition ?? "",
            level: cefrLevel,
            focusPattern,
          },
        });
        if (active) {
          setExerciseData(res);
          setLearnerAnswer(res.incorrectSentence);
        }
      } catch {
        if (active) {
          setExerciseData({
            incorrectSentence: `She ${card.word}ed on the meeting.`,
            correctSentence: `She ${card.word} at the meeting.`,
            errorType: "wrong preposition",
          });
          setLearnerAnswer(`She ${card.word}ed on the meeting.`);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchExercise();
    return () => {
      active = false;
    };
  }, [card.word, card.definition, cefrLevel, focusPattern, getErrorFn]);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!learnerAnswer.trim() || checking || !exerciseData) return;

    setChecking(true);
    try {
      const res = await checkCorrectionFn({
        data: {
          learnerAnswer: learnerAnswer.trim(),
          incorrectSentence: exerciseData.incorrectSentence,
          correctSentence: exerciseData.correctSentence,
        },
      });
      setEvaluation(res);
      onResult(res.isCorrect);

      // Silent background pattern tracking if incorrect
      if (!res.isCorrect) {
        extractPatternFn({
          data: {
            feedbackOrErrorType: `${exerciseData.errorType}: ${res.feedback}`,
          },
        }).catch(() => {});
      }
    } catch {
      const fallbackCorrect =
        learnerAnswer.trim().toLowerCase() === exerciseData.correctSentence.trim().toLowerCase();
      const res = {
        isCorrect: fallbackCorrect,
        feedback: fallbackCorrect
          ? "Great job fixing the sentence!"
          : `Expected: "${exerciseData.correctSentence}"`,
        highlightedAnswer: fallbackCorrect
          ? undefined
          : [{ text: learnerAnswer, isError: true }],
      };
      setEvaluation(res);
      onResult(fallbackCorrect);
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 size={24} className="animate-spin text-[var(--color-crimson)]" />
        <p className="text-xs label-mono uppercase">AI is generating an error correction exercise…</p>
      </div>
    );
  }

  if (!exerciseData) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="label-mono text-xs text-[var(--color-gold)]">
          Correct the mistake in this sentence:
        </p>
        <span className="label-mono text-[9px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
          {exerciseData.errorType}
        </span>
      </div>

      {/* Incorrect Sentence Display */}
      <div className="glass-panel-soft p-5 rounded-xl border border-red-500/30 bg-red-950/15 text-lg font-medium text-red-200">
        <div className="text-[10px] label-mono text-red-400/70 uppercase mb-1">Incorrect sentence</div>
        {exerciseData.incorrectSentence}
      </div>

      {!evaluation ? (
        <form onSubmit={handleCheck} className="space-y-4">
          <div>
            <label className="block text-xs label-mono text-neutral-400 mb-1.5">
              Your corrected version:
            </label>
            <input
              type="text"
              value={learnerAnswer}
              onChange={(e) => setLearnerAnswer(e.target.value)}
              className="w-full glass-panel-soft px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-crimson)] text-white placeholder-neutral-500 font-medium"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!learnerAnswer.trim() || checking}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {checking ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Checking with AI…
              </>
            ) : (
              <>
                <span>Check Correction</span>
                <Send size={14} />
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="space-y-5 animate-in fade-in duration-300">
          <div
            className={`p-5 rounded-xl border space-y-2 ${
              evaluation.isCorrect
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                : "bg-red-950/40 border-red-500/40 text-red-200"
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm">
              {evaluation.isCorrect ? (
                <>
                  <CheckCircle2 size={20} className="text-emerald-400" />
                  <span>Correct Correction!</span>
                </>
              ) : (
                <>
                  <XCircle size={20} className="text-red-400" />
                  <span>Needs Adjustment</span>
                </>
              )}
            </div>
            <p className="text-xs leading-relaxed text-neutral-200">{evaluation.feedback}</p>

            {/* Precise Error Highlighting */}
            {!evaluation.isCorrect && (
              <RenderHighlightedAnswer segments={evaluation.highlightedAnswer} />
            )}

            <div className="pt-2 border-t border-white/10 text-xs text-neutral-300">
              Reference correct sentence:{" "}
              <strong className="text-white">{exerciseData.correctSentence}</strong>
            </div>
          </div>

          <button
            onClick={() => onNext(evaluation.isCorrect)}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <span>Next Exercise</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercise 4: Sentence Transformation
// ---------------------------------------------------------------------------

function SentenceTransformationExercise({
  card,
  cefrLevel,
  focusPattern,
  onResult,
  onNext,
}: {
  card: CardRow;
  cefrLevel: CefrLevel;
  focusPattern?: string;
  onResult: (isCorrect: boolean) => void;
  onNext: (isCorrect: boolean) => void;
}) {
  const getTransFn = useServerFn(generateTransformation);
  const checkTransFn = useServerFn(checkTransformation);
  const extractPatternFn = useServerFn(extractGrammarPattern);

  const [loading, setLoading] = useState(true);
  const [exerciseData, setExerciseData] = useState<{
    originalSentence: string;
    instruction: string;
    expectedTransformation: string;
  } | null>(null);

  const [learnerAnswer, setLearnerAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [evaluation, setEvaluation] = useState<{
    isCorrect: boolean;
    feedback: string;
    highlightedAnswer?: HighlightedSegment[];
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchExercise() {
      setLoading(true);
      try {
        const res = await getTransFn({
          data: {
            word: card.word,
            definition: card.definition ?? "",
            level: cefrLevel,
            focusPattern,
          },
        });
        if (active) {
          setExerciseData(res);
        }
      } catch {
        if (active) {
          setExerciseData({
            originalSentence: `She uses this ${card.word} every day.`,
            instruction: "Rewrite in the simple past tense",
            expectedTransformation: `She used this ${card.word} every day.`,
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchExercise();
    return () => {
      active = false;
    };
  }, [card.word, card.definition, cefrLevel, focusPattern, getTransFn]);

  async function handleCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!learnerAnswer.trim() || checking || !exerciseData) return;

    setChecking(true);
    try {
      const res = await checkTransFn({
        data: {
          learnerAnswer: learnerAnswer.trim(),
          originalSentence: exerciseData.originalSentence,
          instruction: exerciseData.instruction,
          expectedTransformation: exerciseData.expectedTransformation,
        },
      });
      setEvaluation(res);
      onResult(res.isCorrect);

      // Silent background pattern tracking if incorrect
      if (!res.isCorrect) {
        extractPatternFn({
          data: {
            feedbackOrErrorType: `Transformation (${exerciseData.instruction}): ${res.feedback}`,
          },
        }).catch(() => {});
      }
    } catch {
      const fallbackCorrect =
        learnerAnswer.trim().toLowerCase() ===
        exerciseData.expectedTransformation.trim().toLowerCase();
      const res = {
        isCorrect: fallbackCorrect,
        feedback: fallbackCorrect
          ? "Great job transforming the sentence!"
          : `Expected: "${exerciseData.expectedTransformation}"`,
        highlightedAnswer: fallbackCorrect
          ? undefined
          : [{ text: learnerAnswer, isError: true }],
      };
      setEvaluation(res);
      onResult(fallbackCorrect);
    } finally {
      setChecking(false);
    }
  }

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 size={24} className="animate-spin text-[var(--color-crimson)]" />
        <p className="text-xs label-mono uppercase">AI is crafting a sentence transformation exercise…</p>
      </div>
    );
  }

  if (!exerciseData) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="label-mono text-xs text-[var(--color-gold)]">
            Sentence Transformation Instruction:
          </p>
          <span className="label-mono text-[9px] uppercase tracking-wider text-sky-300 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded">
            {exerciseData.instruction}
          </span>
        </div>
        <div className="glass-panel-soft p-5 rounded-xl border border-sky-500/30 bg-sky-950/15 text-lg font-medium text-sky-100">
          <div className="text-[10px] label-mono text-sky-400/70 uppercase mb-1">Original sentence</div>
          {exerciseData.originalSentence}
        </div>
      </div>

      {!evaluation ? (
        <form onSubmit={handleCheck} className="space-y-4">
          <div>
            <label className="block text-xs label-mono text-neutral-400 mb-1.5">
              Your transformed sentence:
            </label>
            <input
              type="text"
              value={learnerAnswer}
              onChange={(e) => setLearnerAnswer(e.target.value)}
              placeholder={`Rewrite according to instruction…`}
              className="w-full glass-panel-soft px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-crimson)] text-white placeholder-neutral-500 font-medium"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!learnerAnswer.trim() || checking}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {checking ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Checking Transformation…
              </>
            ) : (
              <>
                <span>Check Transformation</span>
                <Send size={14} />
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="space-y-5 animate-in fade-in duration-300">
          <div
            className={`p-5 rounded-xl border space-y-2 ${
              evaluation.isCorrect
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-200"
                : "bg-red-950/40 border-red-500/40 text-red-200"
            }`}
          >
            <div className="flex items-center gap-2 font-bold text-sm">
              {evaluation.isCorrect ? (
                <>
                  <CheckCircle2 size={20} className="text-emerald-400" />
                  <span>Correct Transformation!</span>
                </>
              ) : (
                <>
                  <XCircle size={20} className="text-red-400" />
                  <span>Needs Adjustment</span>
                </>
              )}
            </div>
            <p className="text-xs leading-relaxed text-neutral-200">{evaluation.feedback}</p>

            {/* Precise Error Highlighting */}
            {!evaluation.isCorrect && (
              <RenderHighlightedAnswer segments={evaluation.highlightedAnswer} />
            )}

            <div className="pt-2 border-t border-white/10 text-xs text-neutral-300">
              Expected transformation:{" "}
              <strong className="text-white">{exerciseData.expectedTransformation}</strong>
            </div>
          </div>

          <button
            onClick={() => onNext(evaluation.isCorrect)}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <span>Next Exercise</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exercise 5: Free Construction & Mini-Paragraph
// ---------------------------------------------------------------------------

function FreeConstructionExercise({
  card,
  extraCards,
  cefrLevel,
  focusPattern,
  onResult,
  onNext,
}: {
  card: CardRow;
  extraCards?: CardRow[];
  cefrLevel: CefrLevel;
  focusPattern?: string;
  onResult: (isCorrect: boolean) => void;
  onNext: (isCorrect: boolean) => void;
}) {
  const getSingleContextFn = useServerFn(generateDailyContext);
  const getMultiContextFn = useServerFn(generateMultiWordContext);
  const evalSentenceFn = useServerFn(evaluateFreeSentence);
  const evalParagraphFn = useServerFn(evaluateFreeParagraph);
  const extractPatternFn = useServerFn(extractGrammarPattern);

  const isMultiWord = Boolean(extraCards && extraCards.length > 0);
  const allCards = [card, ...(extraCards ?? [])];
  const allWordNames = allCards.map((c) => c.word);

  const [loadingContext, setLoadingContext] = useState(true);
  const [contextPrompt, setContextPrompt] = useState<string>("");
  const [learnerText, setLearnerText] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<{
    grammaticallyCorrect: boolean;
    naturalness: "natural" | "a bit awkward" | "not quite right";
    feedback: string;
    improvedVersion: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchContext() {
      setLoadingContext(true);
      try {
        if (isMultiWord) {
          const res = await getMultiContextFn({
            data: {
              words: allCards.map((c) => ({
                word: c.word,
                definition: c.definition ?? "",
              })),
              level: cefrLevel,
              focusPattern,
            },
          });
          if (active) setContextPrompt(res.context);
        } else {
          const res = await getSingleContextFn({
            data: {
              word: card.word,
              level: cefrLevel,
              focusPattern,
            },
          });
          if (active) setContextPrompt(res.context);
        }
      } catch {
        if (active) {
          setContextPrompt(
            isMultiWord
              ? `Write a short 3-4 sentence paragraph connecting these target words: ${allWordNames.join(", ")}.`
              : `Use the word "${card.word}" in a short sentence describing a daily situation.`,
          );
        }
      } finally {
        if (active) setLoadingContext(false);
      }
    }
    void fetchContext();
    return () => {
      active = false;
    };
  }, [card.word, cefrLevel, focusPattern, isMultiWord]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!learnerText.trim() || evaluating) return;

    setEvaluating(true);
    try {
      if (isMultiWord) {
        const res = await evalParagraphFn({
          data: {
            words: allWordNames,
            context: contextPrompt,
            learnerParagraph: learnerText.trim(),
            level: cefrLevel,
          },
        });
        setEvaluation(res);
        const acceptable = res.grammaticallyCorrect && res.naturalness !== "not quite right";
        onResult(acceptable);

        if (!acceptable) {
          extractPatternFn({
            data: { feedbackOrErrorType: `Free paragraph: ${res.feedback}` },
          }).catch(() => {});
        }
      } else {
        const res = await evalSentenceFn({
          data: {
            word: card.word,
            context: contextPrompt,
            learnerSentence: learnerText.trim(),
            level: cefrLevel,
          },
        });
        setEvaluation(res);
        const acceptable = res.grammaticallyCorrect && res.naturalness !== "not quite right";
        onResult(acceptable);

        if (!acceptable) {
          extractPatternFn({
            data: { feedbackOrErrorType: `Free sentence: ${res.feedback}` },
          }).catch(() => {});
        }
      }
    } catch {
      const res = {
        grammaticallyCorrect: true,
        naturalness: "natural" as const,
        feedback: "Good effort! Your writing expresses the idea clearly.",
        improvedVersion: learnerText,
      };
      setEvaluation(res);
      onResult(true);
    } finally {
      setEvaluating(false);
    }
  }

  if (loadingContext) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 size={24} className="animate-spin text-[var(--color-crimson)]" />
        <p className="text-xs label-mono uppercase">AI is creating a scenario prompt…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="label-mono text-xs text-[var(--color-gold)]">
            {isMultiWord ? "Mini-Paragraph Challenge Prompt" : "Free Construction Prompt"}
          </p>
          {isMultiWord && (
            <span className="label-mono text-[9px] uppercase tracking-wider text-[var(--color-gold)] bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30 px-2 py-0.5 rounded">
              Use all {allCards.length} words
            </span>
          )}
        </div>
        <div className="glass-panel-soft p-5 rounded-xl border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/5 text-base font-medium text-neutral-100 flex items-start gap-3">
          <BookOpen size={20} className="text-[var(--color-gold)] shrink-0 mt-0.5" />
          <div>{contextPrompt}</div>
        </div>
      </div>

      {!evaluation ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs label-mono text-neutral-400 mb-1.5">
              {isMultiWord
                ? `Write a 3-4 sentence paragraph using (${allWordNames.join(", ")}):`
                : `Write your own sentence using "${card.word}":`}
            </label>
            <textarea
              rows={isMultiWord ? 4 : 3}
              value={learnerText}
              onChange={(e) => setLearnerText(e.target.value)}
              placeholder={
                isMultiWord
                  ? `Write a coherent paragraph connecting ${allWordNames.join(", ")}…`
                  : `Write a sentence using ${card.word} in this context…`
              }
              className="w-full glass-panel-soft p-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-crimson)] text-white placeholder-neutral-500 font-medium resize-none"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!learnerText.trim() || evaluating}
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {evaluating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Evaluating with AI Coach…
              </>
            ) : (
              <>
                <span>{isMultiWord ? "Submit Paragraph" : "Submit Sentence"}</span>
                <Send size={14} />
              </>
            )}
          </button>
        </form>
      ) : (
        <div className="space-y-5 animate-in fade-in duration-300">
          <div className="glass-panel p-5 rounded-xl border border-white/10 space-y-4">
            {/* Status Badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                  evaluation.grammaticallyCorrect
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
              >
                {evaluation.grammaticallyCorrect ? "✓ Grammatically Correct" : "✗ Grammar Issue"}
              </span>

              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                  evaluation.naturalness === "natural"
                    ? "bg-sky-500/10 border-sky-500/30 text-sky-300"
                    : evaluation.naturalness === "a bit awkward"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    : "bg-red-500/10 border-red-500/30 text-red-300"
                }`}
              >
                Naturalness: {evaluation.naturalness}
              </span>
            </div>

            {/* Coach Feedback */}
            <div className="space-y-1 pl-3 border-l-2 border-[var(--color-crimson)]">
              <p className="label-mono text-[9px] text-[var(--color-gold)] uppercase">Coach Feedback</p>
              <p className="text-sm text-neutral-200">{evaluation.feedback}</p>
            </div>

            {/* Model / Improved Version */}
            <div className="space-y-1 pl-3 border-l-2 border-[var(--color-gold)]">
              <p className="label-mono text-[9px] text-[var(--color-gold)] uppercase">Improved Version (Model Comparison)</p>
              <p className="text-sm font-medium text-white">{evaluation.improvedVersion}</p>
            </div>
          </div>

          <button
            onClick={() =>
              onNext(
                evaluation.grammaticallyCorrect && evaluation.naturalness !== "not quite right",
              )
            }
            className="w-full btn-crimson rounded-xl py-3 text-xs font-audiowide uppercase tracking-wider flex items-center justify-center gap-2"
          >
            <span>Next Exercise</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
