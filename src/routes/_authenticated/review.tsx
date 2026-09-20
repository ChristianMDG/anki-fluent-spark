import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VocabCard, CardRow } from "@/components/VocabCard";
import {
  gradeCard,
  previewFsrsGrades,
  AnkiGrade,
  FSRSCardFields,
} from "@/lib/fsrs-scheduler";
import { CheckCircle2, RotateCcw, Library, Clock, Play, Undo2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/review")({
  component: ReviewPage,
});

function ReviewPage() {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<CardRow[] | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now, setNow] = useState<Date>(new Date());

  // Single-level snapshot for Undo functionality
  const [undoSnapshot, setUndoSnapshot] = useState<{ previousCard: CardRow } | null>(null);

  // Ticker to update current time every second for live countdowns and queue sorting
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initial fetch of due cards (due_at <= now())
  const { data: initialDueCards, isLoading, refetch } = useQuery({
    queryKey: ["cards", "due-queue"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();

      // Primary query: filter by due_at <= now()
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .lte("due_at", nowIso)
        .order("due_at", { ascending: true })
        .limit(50);

      if (!error) {
        return (data ?? []) as CardRow[];
      }

      // Fallback query if due_at column does not exist on remote database yet
      const { data: fallbackData, error: fallbackErr } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (fallbackErr) {
        toast.error("Failed to load review queue: " + fallbackErr.message);
        throw fallbackErr;
      }

      const dueFallback = (fallbackData ?? []).filter((c: any) => {
        if (!c.due_at) return true;
        return new Date(c.due_at).getTime() <= new Date().getTime();
      });

      return dueFallback.slice(0, 50) as CardRow[];
    },
    staleTime: 1000 * 60,
  });

  // Sync initial query results into live session queue
  useEffect(() => {
    if (initialDueCards && queue === null) {
      setQueue(initialDueCards);
    }
  }, [initialDueCards, queue]);

  // Sort queue by due_at ascending
  const sortedQueue = useMemo(() => {
    if (!queue) return [];
    return [...queue].sort((a, b) => {
      const timeA = a.due_at ? new Date(a.due_at).getTime() : 0;
      const timeB = b.due_at ? new Date(b.due_at).getTime() : 0;
      return timeA - timeB;
    });
  }, [queue]);

  const currentCard = sortedQueue.length > 0 ? sortedQueue[0] : null;

  // Check if current card's due time has arrived or is in future
  const currentCardDueMs = currentCard?.due_at
    ? new Date(currentCard.due_at).getTime()
    : now.getTime();
  const timeRemainingMs = Math.max(0, currentCardDueMs - now.getTime());
  const isWaitingForTime = currentCard && timeRemainingMs > 0;

  async function handleGrade(grade: AnkiGrade) {
    if (!currentCard || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // Snapshot previous card state for single-level undo
      setUndoSnapshot({ previousCard: { ...currentCard } });

      const cardFields: FSRSCardFields = {
        fsrs_stability: currentCard.fsrs_stability,
        fsrs_difficulty: currentCard.fsrs_difficulty,
        fsrs_state: currentCard.fsrs_state,
        fsrs_step: currentCard.fsrs_step,
        fsrs_last_review: currentCard.fsrs_last_review,
        due_at: currentCard.due_at,
        repetitions: currentCard.repetitions,
        ease_factor: currentCard.ease_factor,
        interval_days: currentCard.interval_days,
        card_state: currentCard.card_state,
        learning_step: currentCard.learning_step,
      };

      const result = gradeCard(cardFields, grade, now);

      const updatedCard: CardRow = {
        ...currentCard,
        fsrs_stability: result.fsrs_stability,
        fsrs_difficulty: result.fsrs_difficulty,
        fsrs_state: result.fsrs_state,
        fsrs_step: result.fsrs_step,
        fsrs_last_review: result.fsrs_last_review,
        due_at: result.due_at,
        last_reviewed_at: result.last_reviewed_at,
      };

      // Update row in Supabase
      const { error } = await supabase
        .from("cards")
        .update({
          fsrs_stability: result.fsrs_stability,
          fsrs_difficulty: result.fsrs_difficulty,
          fsrs_state: result.fsrs_state,
          fsrs_step: result.fsrs_step,
          fsrs_last_review: result.fsrs_last_review,
          due_at: result.due_at,
          last_reviewed_at: result.last_reviewed_at,
        })
        .eq("id", currentCard.id);

      if (error) {
        console.warn("Card FSRS update warning:", error.message);
      }

      // Check horizon: if new due_at is within short horizon (~20 mins from now), re-insert into live queue
      const diffMinutes = (new Date(result.due_at).getTime() - now.getTime()) / (1000 * 60);
      const isShortHorizon = diffMinutes <= 20;

      setQueue((prevQueue) => {
        const withoutCurrent = (prevQueue ?? []).filter((c) => c.id !== currentCard.id);
        if (isShortHorizon) {
          return [...withoutCurrent, updatedCard];
        }
        return withoutCurrent;
      });

      setCompletedCount((prev) => prev + 1);

      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (err) {
      toast.error("An error occurred saving FSRS review state.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUndo() {
    if (!undoSnapshot || isSubmitting) return;

    const { previousCard } = undoSnapshot;
    setIsSubmitting(true);

    try {
      // Revert in Supabase
      const { error } = await supabase
        .from("cards")
        .update({
          fsrs_stability: previousCard.fsrs_stability ?? null,
          fsrs_difficulty: previousCard.fsrs_difficulty ?? null,
          fsrs_state: previousCard.fsrs_state ?? "new",
          fsrs_step: previousCard.fsrs_step ?? null,
          fsrs_last_review: previousCard.fsrs_last_review ?? null,
          due_at: previousCard.due_at ?? new Date().toISOString(),
          last_reviewed_at: previousCard.last_reviewed_at ?? null,
        })
        .eq("id", previousCard.id);

      if (error) {
        toast.error("Failed to undo card review: " + error.message);
        return;
      }

      setQueue((prevQueue) => {
        const withoutTarget = (prevQueue ?? []).filter((c) => c.id !== previousCard.id);
        return [previousCard, ...withoutTarget];
      });

      setCompletedCount((prev) => Math.max(0, prev - 1));
      setUndoSnapshot(null);
      toast.success(`Undid review for "${previousCard.word}"`);

      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch (err) {
      toast.error("An error occurred restoring card state.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCardDelete() {
    if (!currentCard) return;
    setQueue((prevQueue) => (prevQueue ?? []).filter((c) => c.id !== currentCard.id));
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }

  // Force review immediately if waiting
  function forceReviewNow() {
    if (!currentCard) return;
    setQueue((prevQueue) =>
      (prevQueue ?? []).map((c) =>
        c.id === currentCard.id ? { ...c, due_at: new Date().toISOString() } : c,
      ),
    );
  }

  const currentCardFields: FSRSCardFields = useMemo(() => {
    if (!currentCard) return {};
    return {
      fsrs_stability: currentCard.fsrs_stability,
      fsrs_difficulty: currentCard.fsrs_difficulty,
      fsrs_state: currentCard.fsrs_state,
      fsrs_step: currentCard.fsrs_step,
      fsrs_last_review: currentCard.fsrs_last_review,
      due_at: currentCard.due_at,
      repetitions: currentCard.repetitions,
    };
  }, [currentCard]);

  const previewLabels = useMemo(() => {
    if (!currentCard) return { again: "<1m", hard: "6m", good: "10m", easy: "4d" };
    return previewFsrsGrades(currentCardFields, now);
  }, [currentCard, currentCardFields, now]);

  const queueCounts = useMemo(() => {
    if (!queue) return { newCount: 0, learningCount: 0, reviewCount: 0 };
    let newCount = 0;
    let learningCount = 0;
    let reviewCount = 0;

    for (const card of queue) {
      const state = card.fsrs_state ?? "new";
      if (state === "new") {
        newCount++;
      } else if (state === "learning" || state === "relearning") {
        learningCount++;
      } else if (state === "review") {
        reviewCount++;
      } else {
        newCount++;
      }
    }

    return { newCount, learningCount, reviewCount };
  }, [queue]);

  if (isLoading || queue === null) {
    return <ReviewCardSkeleton />;
  }

  // Queue Empty State
  if (sortedQueue.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 text-center space-y-6 animate-in fade-in duration-500">
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');
          .font-audiowide { font-family: 'Audiowide', sans-serif; }
        `}</style>

        <div className="glass-panel p-8 md:p-12 border-t-4 border-t-emerald-500 bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 rounded-3xl space-y-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
          <div className="w-20 h-20 mx-auto rounded-2xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
            <CheckCircle2 size={42} />
          </div>

          <div className="space-y-2">
            <h1 className="font-audiowide text-2xl md:text-3xl font-black uppercase text-white tracking-tight">
              🎉 All Caught Up!
            </h1>
            <p className="text-neutral-400 text-sm max-w-md mx-auto leading-relaxed">
              {completedCount > 0
                ? `Awesome work! You completed ${completedCount} review step${completedCount > 1 ? "s" : ""} in this sitting. No cards pending right now.`
                : "No cards are currently due for review. Check back later or generate new vocabulary cards!"}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
            <Link
              to="/library"
              className="w-full sm:w-auto btn-crimson font-audiowide text-xs tracking-widest uppercase flex items-center justify-center gap-2 rounded-xl px-6 py-3 shadow-[0_4px_20px_rgba(237,28,36,0.2)] hover:shadow-[0_4px_25px_rgba(237,28,36,0.4)] transition-all duration-300"
            >
              <Library size={16} />
              <span>Go to Library</span>
            </Link>
            <button
              onClick={() => {
                setQueue(null);
                setCompletedCount(0);
                refetch();
              }}
              className="w-full sm:w-auto font-audiowide text-xs tracking-widest uppercase flex items-center justify-center gap-2 rounded-xl px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-300 hover:text-white transition-all duration-300"
            >
              <RotateCcw size={16} />
              <span>Refresh Queue</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Format countdown string M:SS
  const formatCountdown = (ms: number) => {
    const totalSec = Math.ceil(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs.toString().padStart(2, "0")}s`;
  };

  if (!currentCard) return null;

  return (
    <div className="max-w-xl mx-auto space-y-5 animate-in fade-in duration-500">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');
        .font-audiowide { font-family: 'Audiowide', sans-serif; }
      `}</style>

      {/* Header & Running Queue Progress */}
      <div className="flex items-center justify-between glass-panel px-4 py-3 rounded-2xl bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--color-crimson)] shadow-[0_0_8px_var(--color-crimson)] animate-pulse" />
          <span className="font-audiowide text-xs font-bold uppercase tracking-wider text-white">
            FSRS Live Session
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {undoSnapshot && (
            <button
              onClick={handleUndo}
              disabled={isSubmitting}
              title={`Undo last review for "${undoSnapshot.previousCard.word}"`}
              className="font-audiowide text-[11px] text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg px-2.5 py-1 flex items-center gap-1 transition-all"
            >
              <Undo2 size={12} />
              <span>Undo</span>
            </button>
          )}

          {/* Anki 3-bucket queue breakdown */}
          <div className="flex items-center gap-1.5 font-audiowide text-[11px]">
            {/* New Cards (Blue/Sky) */}
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-sky-950/50 border border-sky-500/30 text-sky-300 shadow-[0_0_8px_rgba(56,189,248,0.15)]"
              title="New Cards"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span>{queueCounts.newCount} New</span>
            </span>

            {/* Learning / Relearning Cards (Red/Crimson) */}
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-red-950/50 border border-red-500/30 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.15)]"
              title="Learning & Relearning Cards"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span>{queueCounts.learningCount} Learn</span>
            </span>

            {/* Review Cards (Green/Emerald) */}
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
              title="Review Cards"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{queueCounts.reviewCount} Review</span>
            </span>
          </div>
        </div>
      </div>

      {/* Waiting Screen if next card due_at is in the future */}
      {isWaitingForTime ? (
        <div className="glass-panel p-8 text-center space-y-5 bg-black/50 backdrop-blur-md border border-amber-500/30 rounded-3xl shadow-[0_15px_40px_rgba(0,0,0,0.5)] animate-in fade-in duration-300">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-950/40 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_25px_rgba(245,158,11,0.2)]">
            <Clock size={28} className="animate-pulse" />
          </div>

          <div className="space-y-2">
            <h2 className="font-audiowide text-lg font-bold text-white uppercase tracking-wider">
              ⏳ Next card in {formatCountdown(timeRemainingMs)}
            </h2>
            <p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
              This card will come back for another look soon — matching how spaced repetition really works.
            </p>
          </div>

          <div className="pt-2 flex justify-center">
            <button
              onClick={forceReviewNow}
              className="btn-crimson font-audiowide text-xs tracking-widest uppercase flex items-center gap-2 rounded-xl px-5 py-2.5 transition-all duration-300"
            >
              <Play size={14} />
              <span>Review Now Anyway</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Card Display Container */}
          <div className="relative w-full min-w-0">
            <VocabCard
              key={currentCard.id}
              card={currentCard}
              compact={true}
              layout="sidebar"
              showFullDetails={true}
              onDelete={handleCardDelete}
            />
          </div>

          {/* Grade Buttons Bar */}
          <div className="glass-panel p-3.5 bg-black/60 backdrop-blur-xl border border-[var(--color-border)]/50 rounded-2xl shadow-[0_15px_35px_rgba(0,0,0,0.6)] space-y-2">
            <p className="font-audiowide text-[9px] uppercase tracking-[0.2em] text-neutral-400 text-center select-none">
              Grade Recall Quality (FSRS)
            </p>

            <div className="grid grid-cols-4 gap-2">
              {/* Again Button */}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleGrade("again")}
                className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 transition-all duration-200 active:scale-95 group shadow-[0_0_12px_rgba(239,68,68,0.1)] disabled:opacity-50"
              >
                <span className="font-audiowide text-xs font-bold uppercase tracking-wider group-hover:scale-105 transition-transform">
                  Again
                </span>
                <span className="text-[9px] font-mono text-red-400/80 mt-0.5">
                  → {previewLabels.again}
                </span>
              </button>

              {/* Hard Button */}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleGrade("hard")}
                className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl bg-amber-950/40 hover:bg-amber-900/60 border border-amber-500/30 text-amber-300 transition-all duration-200 active:scale-95 group shadow-[0_0_12px_rgba(245,158,11,0.1)] disabled:opacity-50"
              >
                <span className="font-audiowide text-xs font-bold uppercase tracking-wider group-hover:scale-105 transition-transform">
                  Hard
                </span>
                <span className="text-[9px] font-mono text-amber-400/80 mt-0.5">
                  → {previewLabels.hard}
                </span>
              </button>

              {/* Good Button */}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleGrade("good")}
                className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl bg-sky-950/40 hover:bg-sky-900/60 border border-sky-500/30 text-sky-300 transition-all duration-200 active:scale-95 group shadow-[0_0_12px_rgba(56,189,248,0.1)] disabled:opacity-50"
              >
                <span className="font-audiowide text-xs font-bold uppercase tracking-wider group-hover:scale-105 transition-transform">
                  Good
                </span>
                <span className="text-[9px] font-mono text-sky-400/80 mt-0.5">
                  → {previewLabels.good}
                </span>
              </button>

              {/* Easy Button */}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleGrade("easy")}
                className="flex flex-col items-center justify-center py-2.5 px-2 rounded-xl bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 transition-all duration-200 active:scale-95 group shadow-[0_0_12px_rgba(16,185,129,0.1)] disabled:opacity-50"
              >
                <span className="font-audiowide text-xs font-bold uppercase tracking-wider group-hover:scale-105 transition-transform">
                  Easy
                </span>
                <span className="text-[9px] font-mono text-emerald-400/80 mt-0.5">
                  → {previewLabels.easy}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ReviewCardSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-5 animate-pulse">
      <div className="flex items-center justify-between glass-panel px-4 py-3 rounded-2xl bg-black/40 border border-[var(--color-border)]/40">
        <div className="w-28 h-4 rounded bg-white/10" />
        <div className="w-40 h-4 rounded bg-white/10" />
      </div>

      <div className="glass-panel p-6 space-y-4 rounded-2xl bg-black/40 border border-white/10 h-[320px] flex flex-col justify-between">
        <div className="space-y-3">
          <div className="flex justify-between items-start">
            <div className="w-36 h-7 rounded bg-white/10" />
            <div className="w-16 h-5 rounded bg-white/10" />
          </div>
          <div className="w-24 h-4 rounded bg-white/5" />
        </div>
        <div className="space-y-2">
          <div className="w-full h-3 rounded bg-white/5" />
          <div className="w-5/6 h-3 rounded bg-white/5" />
        </div>
        <div className="w-32 h-3 rounded bg-white/10" />
      </div>

      <div className="glass-panel p-3.5 bg-black/60 border border-white/10 rounded-2xl space-y-2">
        <div className="w-32 h-3 rounded bg-white/10 mx-auto" />
        <div className="grid grid-cols-4 gap-2">
          <div className="h-12 rounded-xl bg-white/5" />
          <div className="h-12 rounded-xl bg-white/5" />
          <div className="h-12 rounded-xl bg-white/5" />
          <div className="h-12 rounded-xl bg-white/5" />
        </div>
      </div>
    </div>
  );
}
