import { useState, useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VocabCard, CardRow } from "@/components/VocabCard";
import { calculateSM2, previewIntervalLabel, SM2Grade } from "@/lib/sm2";
import { Sparkles, CheckCircle2, RotateCcw, ArrowRight, Library, Flame } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/review")({
  component: ReviewPage,
});

function ReviewPage() {
  const qc = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionCompletedCount, setSessionCompletedCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch due cards (due_at <= now()) with fallback if due_at column does not exist on remote DB yet
  const { data: dueCards, isLoading, refetch } = useQuery({
    queryKey: ["cards", "due-queue"],
    queryFn: async () => {
      const now = new Date();
      const nowIso = now.toISOString();

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
        if (!c.due_at) return true; // cards without due_at default to due immediately
        return new Date(c.due_at).getTime() <= now.getTime();
      });

      return dueFallback.slice(0, 50) as CardRow[];
    },
    staleTime: 1000 * 60, // 1 minute
  });

  const totalInSession = useMemo(() => {
    if (!dueCards) return 0;
    return dueCards.length;
  }, [dueCards]);

  const currentCard = dueCards && currentIndex < dueCards.length ? dueCards[currentIndex] : null;

  async function handleGrade(grade: SM2Grade) {
    if (!currentCard || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const cardState = {
        ease_factor: currentCard.ease_factor ?? 2.5,
        interval_days: currentCard.interval_days ?? 0,
        repetitions: currentCard.repetitions ?? 0,
      };

      const result = calculateSM2(cardState, grade);

      const { error } = await supabase
        .from("cards")
        .update({
          ease_factor: result.ease_factor,
          interval_days: result.interval_days,
          repetitions: result.repetitions,
          due_at: result.due_at,
          last_reviewed_at: new Date().toISOString(),
        })
        .eq("id", currentCard.id);

      if (error) {
        // Log warning if database column is missing on remote backend, but allow UI session to continue
        console.warn("Card update warning:", error.message);
      }

      // Invalidate queries so dashboard/library update immediately
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["stats"] });

      setSessionCompletedCount((prev) => prev + 1);
      setCurrentIndex((prev) => prev + 1);
    } catch (err) {
      toast.error("An unexpected error occurred during review.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Handle card deletion from review view
  function handleCardDelete() {
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    setCurrentIndex((prev) => prev + 1);
  }

  if (isLoading) {
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
  if (!dueCards || dueCards.length === 0 || currentIndex >= dueCards.length) {
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
              {sessionCompletedCount > 0
                ? `Awesome work! You reviewed ${sessionCompletedCount} card${sessionCompletedCount > 1 ? "s" : ""} in this session. No cards due right now.`
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
                setCurrentIndex(0);
                setSessionCompletedCount(0);
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

  // If no card is available, empty state handles it above.
  if (!currentCard) return null;

  const cardState = {
    ease_factor: currentCard.ease_factor ?? 2.5,
    interval_days: currentCard.interval_days ?? 0,
    repetitions: currentCard.repetitions ?? 0,
  };

  const previewAgain = previewIntervalLabel(cardState, 0);
  const previewHard = previewIntervalLabel(cardState, 3);
  const previewGood = previewIntervalLabel(cardState, 4);
  const previewEasy = previewIntervalLabel(cardState, 5);

  return (
    <div className="max-w-xl mx-auto space-y-5 animate-in fade-in duration-500">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');
        .font-audiowide { font-family: 'Audiowide', sans-serif; }
      `}</style>

      {/* Header & Session Progress Indicator */}
      <div className="flex items-center justify-between glass-panel px-4 py-3 rounded-2xl bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 shadow-lg">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--color-crimson)] shadow-[0_0_8px_var(--color-crimson)] animate-pulse" />
          <span className="font-audiowide text-xs font-bold uppercase tracking-wider text-white">
            SRS Review Session
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-audiowide text-[11px] text-[var(--color-gold)] bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30 rounded-lg px-2.5 py-1">
            Card {currentIndex + 1} of {totalInSession}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden border border-white/5">
        <div
          className="bg-gradient-to-r from-[var(--color-crimson)] to-[var(--color-gold)] h-full transition-all duration-300 ease-out"
          style={{ width: `${((currentIndex + 1) / totalInSession) * 100}%` }}
        />
      </div>

      {/* Card Container */}
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
            onClick={() => handleGrade(0)}
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
            onClick={() => handleGrade(3)}
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
            onClick={() => handleGrade(4)}
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
            onClick={() => handleGrade(5)}
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
    </div>
  );
}
