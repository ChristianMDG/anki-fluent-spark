import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VocabCard, CardRow } from "@/components/VocabCard";
import {
  scheduleCard,
  previewIntervalLabel,
  AnkiGrade,
  formatDelayLabel,
  CardSRSMetrics,
} from "@/lib/sm2";
import { CheckCircle2, RotateCcw, Library, Clock, Play } from "lucide-react";
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
      const cardMetrics: CardSRSMetrics = {
        card_state: currentCard.card_state,
        learning_step: currentCard.learning_step,
        ease_factor: currentCard.ease_factor,
        interval_days: currentCard.interval_days,
        repetitions: currentCard.repetitions,
      };

      const result = scheduleCard(cardMetrics, grade, now);

      const updatedCard: CardRow = {
        ...currentCard,
        card_state: result.card_state,
        learning_step: result.learning_step,
        ease_factor: result.ease_factor,
        interval_days: result.interval_days,
        repetitions: result.repetitions,
        due_at: result.due_at,
        last_reviewed_at: new Date().toISOString(),
      };

      // Update row in Supabase
      const { error } = await supabase
        .from("cards")
        .update({
          card_state: result.card_state,
          learning_step: result.learning_step,
          ease_factor: result.ease_factor,
          interval_days: result.interval_days,
          repetitions: result.repetitions,
          due_at: result.due_at,
          last_reviewed_at: updatedCard.last_reviewed_at,
        })
        .eq("id", currentCard.id);

      if (error) {
        console.warn("Card update warning:", error.message);
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
      toast.error("An error occurred saving review state.");
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

  if (isLoading || queue === null) {
    return (
      <div className="w-full h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-2 border-[var(--color-crimson)] border-t-transparent rounded-full animate-spin" />
        <p className="font-audiowide text-xs tracking-widest text-neutral-400 uppercase">
          Loading Review Queue...
        </p>
      </div>
    );
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

  const cardMetrics: CardSRSMetrics = {
    card_state: currentCard.card_state,
    learning_step: currentCard.learning_step,
    ease_factor: currentCard.ease_factor,
    interval_days: currentCard.interval_days,
    repetitions: currentCard.repetitions,
  };

  const previewAgain = previewIntervalLabel(cardMetrics, "again", now);
  const previewHard = previewIntervalLabel(cardMetrics, "hard", now);
  const previewGood = previewIntervalLabel(cardMetrics, "good", now);
  const previewEasy = previewIntervalLabel(cardMetrics, "easy", now);

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
            SRS Live Session
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-audiowide text-[11px] text-[var(--color-gold)] bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30 rounded-lg px-2.5 py-1">
            {completedCount > 0 ? `Done: ${completedCount} · ` : ""}
            {sortedQueue.length} left in session
          </span>
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
              Grade Recall Quality
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
                  → {previewAgain}
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
                  → {previewHard}
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
                  → {previewGood}
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
                  → {previewEasy}
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
