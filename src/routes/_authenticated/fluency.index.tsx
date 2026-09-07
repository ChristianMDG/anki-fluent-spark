import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  generateSessionTheme,
  generateFluencyPrompt,
  generateDialogueReply,
  generateDialogueHint,
  generateSpeakingFeedback,
  extractAndSaveWeakPoint,
} from "@/lib/fluency.functions";
import {
  SESSION_CONFIG,
  type SessionLength,
} from "@/lib/fluency-themes";
import {
  CEFR_LEVELS,
  nextCefrLevel,
  type CefrLevel,
  type LearnerProfile,
  type LearnerWeakPoint,
} from "@/integrations/supabase/learner-profile.types";
import { WeakPointsPanel } from "@/components/fluency/WeakPointsPanel";
import { PitchContourChart } from "@/components/fluency/PitchContourChart";
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech";
import { z } from "zod";
import {
  Mic,
  Square,
  RotateCcw,
  Pin,
  BookOpen,
  Volume2,
  Flame,
  ChevronRight,
  ArrowLeft,
  Lightbulb,
  Subtitles,
  Loader2,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  X,
  Sparkles,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fluency/")({
  validateSearch: () => ({}),
  component: FluencyPage,
});

type ExerciseType = "free_talk" | "chunk_repeat" | "dialogue";

interface DialogueTurn {
  speaker: "ai" | "learner";
  text: string;
}

interface Exercise {
  type: ExerciseType;
  prompt: string;
  chunks?: string[];
  vocab?: string[];
}

interface RecordingState {
  blob: Blob;
  url: string;
  durationSec: number;
  storagePath?: string;
  recordingId?: string;
  ratings: { fluency: number; confidence: number; hesitation: number };
  pinned: boolean;
  dialogueTurns?: DialogueTurn[];
}

type SessionMode = "mixed" | "free_talk" | "chunk_repeat" | "dialogue";

// ---------------------------------------------------------------------------
// Hooks — Learner Profile
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

      // Lazy-init profile row if missing (safely catch if RPC doesn't exist yet)
      try {
        await (
          supabase.rpc as unknown as (
            fn: string,
            args: { _user: string },
          ) => Promise<unknown>
        )("ensure_learner_profile", { _user: user.id });
      } catch {
        // Ignore if RPC missing
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

function useWeakPoints() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["learner-weak-points"],
    queryFn: async (): Promise<LearnerWeakPoint[]> => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return [];

        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, val: string) => {
                eq: (col: string, val: boolean) => {
                  order: (col: string, opts: Record<string, boolean>) => {
                    limit: (n: number) => Promise<{ data: LearnerWeakPoint[] | null; error: unknown }>;
                  };
                };
              };
            };
          };
        })
          .from("learner_weak_points")
          .select("*")
          .eq("user_id", user.id)
          .eq("resolved", false)
          .order("occurrences", { ascending: false })
          .limit(10);

        if (error) return [];
        return (data as LearnerWeakPoint[] | null) ?? [];
      } catch {
        return [];
      }
    },

    staleTime: 20_000,
  });

  const resolveWeakPoint = useCallback(
    async (id: string) => {
      await (supabase as unknown as {
        from: (t: string) => {
          update: (vals: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: unknown }>;
          };
        };
      })
        .from("learner_weak_points")
        .update({ resolved: true })
        .eq("id", id);

      qc.invalidateQueries({ queryKey: ["learner-weak-points"] });
    },
    [qc],
  );

  return {
    weakPoints: query.data ?? [],
    resolveWeakPoint,
    refetch: () => qc.invalidateQueries({ queryKey: ["learner-weak-points"] }),
  };
}

interface LevelUpSuggestion {
  show: boolean;
  currentLevel: CefrLevel;
  nextLevel: CefrLevel;
}

const LEVEL_UP_DISMISS_KEY = "fluency_levelup_dismissed";
const DISMISS_SESSIONS_COOLDOWN = 5;

function useLevelUpSuggestion(profile: LearnerProfile | undefined) {
  const currentLevel = profile?.current_level ?? "B1";
  const next = nextCefrLevel(currentLevel);

  const { data: recentRecordings } = useQuery({
    queryKey: ["fluency-level-up-check", currentLevel],
    enabled: !!profile && !!next,
    queryFn: async (): Promise<{ fluency_rating: number | null; confidence_rating: number | null }[]> => {
      const { data } = await supabase
        .from("fluency_recordings")
        .select("fluency_rating, confidence_rating")
        .order("created_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const suggestion = useMemo((): LevelUpSuggestion | null => {
    if (!next || !recentRecordings || recentRecordings.length < 5) return null;

    const rated = recentRecordings.filter(
      (r) => r.fluency_rating != null && r.confidence_rating != null,
    );
    if (rated.length < 5) return null;

    const avgFluency =
      rated.reduce((s, r) => s + (r.fluency_rating ?? 0), 0) / rated.length;
    const avgConfidence =
      rated.reduce((s, r) => s + (r.confidence_rating ?? 0), 0) / rated.length;

    if (avgFluency < 4.2 || avgConfidence < 4.2) return null;

    try {
      const raw = localStorage.getItem(LEVEL_UP_DISMISS_KEY);
      if (raw) {
        const { level, sessionCount } = JSON.parse(raw) as {
          level: string;
          sessionCount: number;
        };
        if (level === currentLevel) {
          if (recentRecordings.length - sessionCount < DISMISS_SESSIONS_COOLDOWN) return null;
        }
      }
    } catch {
      /* ignore */
    }

    return { show: true, currentLevel, nextLevel: next };
  }, [next, recentRecordings, currentLevel]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(
        LEVEL_UP_DISMISS_KEY,
        JSON.stringify({ level: currentLevel, sessionCount: recentRecordings?.length ?? 0 }),
      );
    } catch {
      /* ignore */
    }
  }, [currentLevel, recentRecordings]);

  return { suggestion, dismiss };
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

function FluencyPage() {
  const [phase, setPhase] = useState<"entry" | "session" | "summary">("entry");
  const [length, setLength] = useState<SessionLength>("standard");
  const [sessionMode, setSessionMode] = useState<SessionMode>("mixed");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [recordings, setRecordings] = useState<RecordingState[]>([]);
  const [step, setStep] = useState(0);

  const [sessionTheme, setSessionTheme] = useState<string>("Weekend plans and hobbies");
  const [themeLoading, setThemeLoading] = useState(false);

  const streak = useFluencyStreak();
  const getTheme = useServerFn(generateSessionTheme);
  const genPrompt = useServerFn(generateFluencyPrompt);
  const qc = useQueryClient();

  const { profile, setLevel, isLoading: profileLoading } = useLearnerProfile();
  const { weakPoints, resolveWeakPoint, refetch: refetchWeakPoints } = useWeakPoints();
  const { suggestion: levelUpSuggestion, dismiss: dismissLevelUp } = useLevelUpSuggestion(profile);

  const cefrLevel = profile?.current_level ?? "B1";

  // Fetch initial theme when profile level changes or component mounts
  const fetchThemeForLevel = useCallback(
    async (lvl: CefrLevel) => {
      setThemeLoading(true);
      try {
        const { theme } = await getTheme({ data: { level: lvl } });
        setSessionTheme(theme);
      } catch {
        setSessionTheme("Weekend plans and hobbies");
      } finally {
        setThemeLoading(false);
      }
    },
    [getTheme],
  );

  useEffect(() => {
    if (profile?.current_level) {
      void fetchThemeForLevel(profile.current_level);
    }
  }, [profile?.current_level, fetchThemeForLevel]);

  async function handleSetLevel(lvl: CefrLevel) {
    await setLevel(lvl);
    await fetchThemeForLevel(lvl);
  }

  async function handleRefreshTheme() {
    await fetchThemeForLevel(cefrLevel);
  }

  async function pickVocabWords(): Promise<string[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from("cards")
      .select("word")
      .order("created_at", { ascending: false })
      .limit(40);
    const words = (data ?? []).map((r) => r.word);
    return shuffle(words).slice(0, Math.min(3, words.length));
  }

  async function buildExercises(count: number): Promise<Exercise[]> {
    const modeToOrder: Record<SessionMode, ExerciseType[]> = {
      mixed: ["free_talk", "chunk_repeat", "dialogue"],
      free_talk: ["free_talk"],
      chunk_repeat: ["chunk_repeat"],
      dialogue: ["dialogue"],
    };
    const order: ExerciseType[] = modeToOrder[sessionMode];
    const chunks = await loadChunksPool();
    const vocab = await pickVocabWords();
    const topWeakPoints = weakPoints.slice(0, 2).map((p) => p.tag);

    const out: Exercise[] = [];
    for (let i = 0; i < count; i++) {
      const type = order[i % order.length];
      if (type === "chunk_repeat") {
        const picked = chunks.length
          ? shuffle(chunks).slice(0, Math.min(5, Math.max(3, chunks.length)))
          : ["on the other hand", "to be honest", "at the end of the day", "as far as I know"];
        out.push({ type, prompt: picked.join(" • "), chunks: picked, vocab });
      } else {
        try {
          const { prompt } = await genPrompt({
            data: {
              type,
              theme: sessionTheme,
              level: cefrLevel,
              ...(vocab.length ? { vocabularyWords: vocab } : {}),
              ...(topWeakPoints.length ? { focusAreas: topWeakPoints } : {}),
            },
          });
          out.push({
            type,
            prompt,
            vocab,
          });
        } catch {
          out.push({
            type,
            prompt:
              type === "free_talk"
                ? `Talk for a minute about: ${sessionTheme}.`
                : `What's your perspective on ${sessionTheme}?`,
            vocab,
          });
        }
      }
    }
    return out;
  }

  const startSession = useMutation({
    mutationFn: async () => {
      const cfg = SESSION_CONFIG[length];
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { data: sess, error } = await supabase
        .from("fluency_sessions")
        .insert({
          user_id: user.id,
          session_length: length,
          week_theme: sessionTheme,
        })
        .select()
        .single();
      if (error) throw error;
      const exs = await buildExercises(cfg.exerciseCount);
      return { sessionId: sess.id, exs };
    },
    onSuccess: ({ sessionId, exs }) => {
      setSessionId(sessionId);
      setExercises(exs);
      setRecordings([]);
      setStep(0);
      setPhase("session");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function finishSession() {
    if (sessionId) {
      await supabase
        .from("fluency_sessions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
    setPhase("summary");
  }

  if (phase === "entry") {
    return (
      <FluencyEntry
        length={length}
        setLength={setLength}
        sessionMode={sessionMode}
        setSessionMode={setSessionMode}
        onStart={() => startSession.mutate()}
        starting={startSession.isPending}
        streak={streak.data ?? 0}
        profile={profile ?? null}
        profileLoading={profileLoading}
        onSetLevel={handleSetLevel}
        sessionTheme={sessionTheme}
        themeLoading={themeLoading}
        onRefreshTheme={handleRefreshTheme}
        weakPoints={weakPoints}
        onResolveWeakPoint={resolveWeakPoint}
        levelUpSuggestion={levelUpSuggestion}
        onLevelUp={async () => {
          if (levelUpSuggestion) {
            await handleSetLevel(levelUpSuggestion.nextLevel);
            dismissLevelUp();
          }
        }}
        onDismissLevelUp={dismissLevelUp}
      />
    );
  }

  if (phase === "session" && sessionId) {
    const ex = exercises[step];
    if (!ex) return null;
    return (
      <SessionRunner
        key={step}
        exercise={ex}
        sessionId={sessionId}
        sessionTheme={sessionTheme}
        cefrLevel={cefrLevel}
        stepIndex={step}
        totalSteps={exercises.length}
        freeTalkSeconds={SESSION_CONFIG[length].freeTalkSeconds}
        onComplete={(rec) => {
          setRecordings((prev) => [...prev, rec]);
          refetchWeakPoints();
          if (step + 1 < exercises.length) setStep(step + 1);
          else void finishSession();
        }}
        onBack={() => {
          setPhase("entry");
          setRecordings([]);
          setExercises([]);
          setSessionId(null);
          setStep(0);
        }}
      />
    );
  }

  if (phase === "summary") {
    const avg = averageRatings(recordings);
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="glass-panel p-8 text-center space-y-4">
          <p className="label-mono text-[color:var(--color-gold)]">Session Complete</p>
          <h1 className="text-3xl font-bold">Nicely done.</h1>
          <p className="text-muted-foreground">
            {recordings.length} exercise{recordings.length > 1 ? "s" : ""} recorded.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <SummaryStat label="Fluency" value={avg.fluency} />
            <SummaryStat label="Confidence" value={avg.confidence} />
            <SummaryStat label="Hesitations" value={avg.hesitation} />
          </div>
          <div className="flex gap-3 justify-center pt-4">
            <button
              onClick={() => {
                setPhase("entry");
                setRecordings([]);
                setExercises([]);
                setSessionId(null);
              }}
              className="btn-crimson rounded-lg px-5 py-2.5"
            >
              Back to Fluency Entry
            </button>
            <Link
              to="/fluency/journal"
              className="rounded-lg px-5 py-2.5 border border-[color:var(--color-border)] hover:bg-white/5"
            >
              View Journal
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry Screen
// ---------------------------------------------------------------------------

function FluencyEntry({
  length,
  setLength,
  sessionMode,
  setSessionMode,
  onStart,
  starting,
  streak,
  profile,
  profileLoading,
  onSetLevel,
  sessionTheme,
  themeLoading,
  onRefreshTheme,
  weakPoints,
  onResolveWeakPoint,
  levelUpSuggestion,
  onLevelUp,
  onDismissLevelUp,
}: {
  length: SessionLength;
  setLength: (l: SessionLength) => void;
  sessionMode: SessionMode;
  setSessionMode: (m: SessionMode) => void;
  onStart: () => void;
  starting: boolean;
  streak: number;
  profile: LearnerProfile | null;
  profileLoading: boolean;
  onSetLevel: (level: CefrLevel) => Promise<void>;
  sessionTheme: string;
  themeLoading: boolean;
  onRefreshTheme: () => Promise<void>;
  weakPoints: LearnerWeakPoint[];
  onResolveWeakPoint: (id: string) => Promise<void>;
  levelUpSuggestion: { show: boolean; currentLevel: CefrLevel; nextLevel: CefrLevel } | null;
  onLevelUp: () => Promise<void>;
  onDismissLevelUp: () => void;
}) {
  useCleanupExpired();
  const [levelingUp, setLevelingUp] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const showBanner = levelUpSuggestion?.show && !bannerDismissed;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Fluency Coach</p>
          <h1 className="text-3xl md:text-4xl font-bold mt-1">Speak like a native.</h1>
          <p className="text-muted-foreground mt-2 max-w-xl">
            A module dedicated to speaking fluency and oral confidence. Practice spontaneous
            conversation, listen back, and track your speaking growth.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass-panel-soft px-4 py-2.5 rounded-lg flex items-center gap-2">
            <Flame size={18} className="text-orange-400" />
            <div>
              <div className="text-lg font-bold leading-none">{streak}</div>
              <div className="label-mono">day{streak !== 1 ? "s" : ""} streak</div>
            </div>
          </div>
          <Link
            to="/fluency/journal"
            className="rounded-lg px-4 py-2.5 border border-[color:var(--color-border)] hover:bg-white/5 flex items-center gap-2 text-sm"
          >
            <BookOpen size={16} /> Journal
          </Link>
        </div>
      </div>

      {/* ---- Learner Profile Card ---- */}
      <div className="glass-panel p-6 md:p-8 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="label-mono">Your CEFR Level</p>
            {profileLoading ? (
              <div className="flex items-center gap-2 mt-2 text-muted-foreground text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading profile…
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-2">
                {CEFR_LEVELS.map((lvl) => {
                  const active = (profile?.current_level ?? "B1") === lvl;
                  return (
                    <button
                      key={lvl}
                      onClick={() => onSetLevel(lvl)}
                      className={`px-3.5 py-1.5 rounded-full border text-sm font-semibold transition motion-safe:transition-all ${
                        active
                          ? "border-[color:var(--color-crimson-glow)] bg-[color:var(--color-crimson)]/20 text-white shadow-[0_0_12px_rgba(237,28,36,0.3)] scale-105"
                          : "border-[color:var(--color-border)] text-muted-foreground hover:border-[color:var(--color-border)]/80 hover:text-foreground"
                      }`}
                      aria-pressed={active}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Level-up suggestion banner */}
        {showBanner && levelUpSuggestion && (
          <div className="rounded-xl border border-[color:var(--color-gold)]/40 bg-[color:var(--color-gold)]/8 px-5 py-4 flex items-start gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            <TrendingUp size={18} className="text-[color:var(--color-gold)] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                You've been doing great at {levelUpSuggestion.currentLevel} — ready to try{" "}
                {levelUpSuggestion.nextLevel}?
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  onClick={async () => {
                    setLevelingUp(true);
                    await onLevelUp();
                    setLevelingUp(false);
                    setBannerDismissed(true);
                  }}
                  disabled={levelingUp}
                  className="btn-crimson rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {levelingUp ? <Loader2 size={12} className="animate-spin" /> : <TrendingUp size={12} />}
                  Level up to {levelUpSuggestion.nextLevel}
                </button>
                <button
                  onClick={() => {
                    onDismissLevelUp();
                    setBannerDismissed(true);
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs border border-[color:var(--color-border)] hover:bg-white/5 text-muted-foreground"
                >
                  Not yet
                </button>
              </div>
            </div>
            <button
              onClick={() => {
                onDismissLevelUp();
                setBannerDismissed(true);
              }}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <WeakPointsPanel
          weakPoints={weakPoints}
          onResolve={onResolveWeakPoint}
          compact
        />
      </div>

      {/* ---- AI Theme Card ---- */}
      <div className="glass-panel p-6 md:p-8 relative overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 label-mono text-[color:var(--color-gold)]">
              <Sparkles size={14} /> AI Session Topic
            </div>
            <h2 className="text-2xl font-bold mt-2 text-[color:var(--color-gold)] flex items-center gap-2 min-h-[36px]">
              {themeLoading ? (
                <span className="flex items-center gap-2 text-muted-foreground text-lg font-normal">
                  <Loader2 size={18} className="animate-spin text-[color:var(--color-gold)]" /> AI is crafting a topic for {profile?.current_level ?? "B1"}…
                </span>
              ) : (
                sessionTheme
              )}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              AI-generated conversation scenario tailored for level {profile?.current_level ?? "B1"}.
            </p>
          </div>
          <button
            onClick={() => void onRefreshTheme()}
            disabled={themeLoading}
            className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm border border-[color:var(--color-border)] hover:bg-white/5 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
            title="Generate a new topic"
          >
            <RefreshCw size={14} className={themeLoading ? "animate-spin" : ""} /> 🔄 New theme
          </button>
        </div>
      </div>

      {/* ---- Session Duration ---- */}
      <div>
        <p className="label-mono mb-3">Session Duration</p>
        <div className="grid md:grid-cols-3 gap-3">
          {(["quick", "standard", "deep"] as SessionLength[]).map((k) => {
            const cfg = SESSION_CONFIG[k];
            const active = length === k;
            return (
              <button
                key={k}
                onClick={() => setLength(k)}
                className={`glass-panel p-5 text-left transition ${
                  active
                    ? "border-[color:var(--color-crimson-glow)] bg-[color:var(--color-crimson)]/10 -translate-y-0.5 shadow-[0_0_15px_rgba(237,28,36,0.15)]"
                    : "hover:-translate-y-0.5"
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <div className="text-lg font-semibold">{cfg.label}</div>
                  <div className="label-mono">{cfg.minutes} min</div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {cfg.exerciseCount} exercise{cfg.exerciseCount > 1 ? "s" : ""} included
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- Session Type Selector ---- */}
      <div>
        <p className="label-mono mb-3">Session Type</p>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          {(
            [
              {
                key: "mixed" as const,
                label: "Mixed",
                desc: "Rotates through Free Talk, Chunk Repeat, and Dialogue.",
                icon: Sparkles,
              },
              {
                key: "free_talk" as const,
                label: "Free Talk only",
                desc: "Every exercise is an open-ended speaking prompt.",
                icon: Mic,
              },
              {
                key: "chunk_repeat" as const,
                label: "Chunk Repeat only",
                desc: "Every exercise is a set of expressions to repeat aloud.",
                icon: Volume2,
              },
              {
                key: "dialogue" as const,
                label: "Dialogue only",
                desc: "Real back-and-forth AI conversation with live voice transcript.",
                icon: MessageSquare,
              },
            ] as const
          ).map((m) => {
            const active = sessionMode === m.key;
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => setSessionMode(m.key)}
                className={`glass-panel p-5 text-left transition flex flex-col justify-between ${
                  active
                    ? "border-[color:var(--color-crimson-glow)] bg-[color:var(--color-crimson)]/10 -translate-y-0.5 shadow-[0_0_15px_rgba(237,28,36,0.15)]"
                    : "hover:-translate-y-0.5"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <Icon size={18} className={active ? "text-[color:var(--color-crimson-glow)]" : "text-muted-foreground"} />
                    {m.label}
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{m.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={onStart}
          disabled={starting || themeLoading}
          className="btn-crimson rounded-lg px-6 py-3 text-base font-semibold flex items-center gap-2 disabled:opacity-50 shadow-[0_4px_20px_rgba(237,28,36,0.25)]"
        >
          {starting ? "Preparing exercises…" : "Start Session"} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session runner
// ---------------------------------------------------------------------------

function SessionRunner({
  exercise,
  sessionId,
  sessionTheme,
  cefrLevel,
  stepIndex,
  totalSteps,
  freeTalkSeconds,
  onComplete,
  onBack,
}: {
  exercise: Exercise;
  sessionId: string;
  sessionTheme: string;
  cefrLevel: string;
  stepIndex: number;
  totalSteps: number;
  freeTalkSeconds: number;
  onComplete: (r: RecordingState) => void;
  onBack: () => void;
}) {
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RecordingState | null>(null);
  const [ratings, setRatings] = useState({ fluency: 3, confidence: 3, hesitation: 3 });
  const [saving, setSaving] = useState(false);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getSpeakingFeedback = useServerFn(generateSpeakingFeedback);
  const saveWeakPoint = useServerFn(extractAndSaveWeakPoint);

  const maxSeconds = exercise.type === "free_talk" ? freeTalkSeconds : 120;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (typeof MediaRecorder === "undefined") {
      toast.error("Your browser does not support audio recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const durationSec = Math.round((Date.now() - startTsRef.current) / 1000);
        setResult({
          blob,
          url,
          durationSec,
          ratings: { fluency: 3, confidence: 3, hesitation: 3 },
          pinned: false,
        });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      rec.start();
      setRecorder(rec);
      setRecording(true);
      setElapsed(0);
      startTsRef.current = Date.now();
      timerRef.current = setInterval(() => {
        const e = Math.round((Date.now() - startTsRef.current) / 1000);
        setElapsed(e);
        if (exercise.type === "free_talk" && e >= maxSeconds) stopRecording();
      }, 250);
    } catch {
      toast.error(
        "Microphone access denied. Please allow microphone access in your browser settings to continue.",
      );
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  const [dialogueRetryKey, setDialogueRetryKey] = useState(0);

  function retryRecording() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setElapsed(0);
    setDialogueRetryKey((k) => k + 1);
  }

  function handleBack() {
    if (recording || result) {
      const ok = window.confirm(
        "You have an unsaved recording for this exercise. Going back will discard it. Continue?",
      );
      if (!ok) return;
      if (recording) stopRecording();
    }
    onBack();
  }

  function triggerSilentFeedback(promptText: string, dialogueTurns?: DialogueTurn[]) {
    getSpeakingFeedback({
      data: {
        exerciseType: exercise.type === "dialogue" ? "dialogue" : "free_talk",
        promptText: promptText.slice(0, 300),
        cefrLevel,
        ...(dialogueTurns ? { dialogueTurns } : {}),
      },
    })
      .then(({ tip }) =>
        saveWeakPoint({ data: { tip } })
      )
      .catch(() => {
        /* silent */
      });
  }

  async function uploadAndFinalize() {
    if (!result) return;
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let storagePath = result.storagePath;
      let recordingId = result.recordingId;

      if (!storagePath && result.blob.size > 0) {
        const path = `${user.id}/${sessionId}/${crypto.randomUUID()}.webm`;
        const { error: upErr } = await supabase.storage
          .from("fluency-recordings")
          .upload(path, result.blob, { contentType: result.blob.type });
        if (upErr) throw upErr;
        storagePath = path;
      }

      if (!recordingId) {
        const { data: row, error } = await supabase
          .from("fluency_recordings")
          .insert({
            user_id: user.id,
            session_id: sessionId,
            exercise_type: exercise.type,
            prompt_text: exercise.prompt,
            week_theme: sessionTheme,
            storage_path: storagePath ?? null,
            duration_seconds: result.durationSec,
            fluency_rating: ratings.fluency,
            confidence_rating: ratings.confidence,
            hesitation_rating: ratings.hesitation,
            pinned: result.pinned,
          })
          .select()
          .single();
        if (error) throw error;
        recordingId = row.id;
      } else {
        await supabase
          .from("fluency_recordings")
          .update({
            fluency_rating: ratings.fluency,
            confidence_rating: ratings.confidence,
            hesitation_rating: ratings.hesitation,
            pinned: result.pinned,
          })
          .eq("id", recordingId);
      }

      if (exercise.type === "free_talk" || exercise.type === "dialogue") {
        triggerSilentFeedback(exercise.prompt, result.dialogueTurns);
      }

      onComplete({ ...result, storagePath, recordingId, ratings });
    } catch (e) {
      toast.error(e instanceof Error ? `Upload failed: ${e.message}` : "Upload failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePin() {
    setResult((r) => (r ? { ...r, pinned: !r.pinned } : r));
    if (result?.recordingId) {
      await supabase
        .from("fluency_recordings")
        .update({ pinned: !result.pinned })
        .eq("id", result.recordingId);
    }
  }

  function speakChunk(t: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "en-US";
    window.speechSynthesis.speak(u);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={handleBack}
          className="rounded-lg px-3 py-2 border border-[color:var(--color-border)] hover:bg-white/5 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition"
          aria-label="Back to session setup"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <p className="label-mono">
          Exercise {stepIndex + 1} / {totalSteps}
        </p>
        <p className="label-mono text-[color:var(--color-gold)]">{labelType(exercise.type)}</p>
      </div>

      {exercise.type === "dialogue" ? (
        <InteractiveDialogue
          key={`${exercise.prompt}:${dialogueRetryKey}`}
          openingLine={exercise.prompt}
          sessionTheme={sessionTheme}
          cefrLevel={cefrLevel}
          vocab={exercise.vocab}
          result={result}
          onFinish={(r: RecordingState) => setResult(r)}
        />
      ) : (
        <>
          <div className="glass-panel p-6 md:p-8">
            {exercise.type === "chunk_repeat" && exercise.chunks ? (
              <div className="space-y-3">
                <p className="label-mono">Repeat these expressions out loud</p>
                <ul className="space-y-2">
                  {exercise.chunks.map((c, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2"
                    >
                      <span className="text-lg">{c}</span>
                      <button
                        onClick={() => speakChunk(c)}
                        className="text-muted-foreground hover:text-[color:var(--color-gold)] transition"
                        title="Listen"
                      >
                        <Volume2 size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <p className="label-mono">Prompt ({cefrLevel} · {sessionTheme})</p>
                <p className="text-xl md:text-2xl font-medium mt-2 leading-relaxed">
                  {exercise.prompt}
                </p>
              </>
            )}
          </div>

          {!result ? (
            <div className="glass-panel p-8 flex flex-col items-center gap-5">
              <button
                onClick={recording ? stopRecording : startRecording}
                className={`relative h-28 w-28 rounded-full flex items-center justify-center transition ${
                  recording
                    ? "bg-[color:var(--color-crimson)] text-white"
                    : "bg-[color:var(--color-crimson)]/80 hover:bg-[color:var(--color-crimson)] text-white"
                }`}
                aria-label={recording ? "Stop recording" : "Start recording"}
              >
                {recording && (
                  <span className="absolute inset-0 rounded-full bg-[color:var(--color-crimson)] opacity-60 motion-reduce:hidden animate-ping" />
                )}
                <span className="relative z-10">
                  {recording ? <Square size={36} /> : <Mic size={36} />}
                </span>
              </button>
              <div className="text-center">
                <div className="text-2xl font-mono font-bold">
                  {formatTime(elapsed)}
                  {exercise.type === "free_talk" && (
                    <span className="text-muted-foreground text-base">
                      {" "}
                      / {formatTime(maxSeconds)}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {recording ? "Recording in progress…" : "Press to start"}
                </p>
              </div>
            </div>
          ) : null}
        </>
      )}

      {result ? (
        <div className="space-y-4">
          <div className="glass-panel p-5 space-y-3">
            <p className="label-mono">Your take ({formatTime(result.durationSec)})</p>
            {result.url ? (
              <>
                <audio src={result.url} controls className="w-full" />
                <PitchContourChart blob={result.blob} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">Text-based dialogue completed without audio stream.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={retryRecording}
                className="rounded-lg px-3 py-2 border border-[color:var(--color-border)] hover:bg-white/5 text-sm flex items-center gap-2"
              >
                <RotateCcw size={14} /> Retry
              </button>
              <button
                onClick={togglePin}
                className={`rounded-lg px-3 py-2 border text-sm flex items-center gap-2 transition ${
                  result.pinned
                    ? "border-[color:var(--color-gold)] text-[color:var(--color-gold)]"
                    : "border-[color:var(--color-border)] hover:bg-white/5"
                }`}
              >
                <Pin size={14} /> {result.pinned ? "Pinned" : "Pin"}
              </button>
            </div>
          </div>

          <div className="glass-panel p-5 space-y-4">
            <p className="label-mono">Self-evaluation</p>
            <RatingSlider
              label="Fluency"
              value={ratings.fluency}
              onChange={(v) => setRatings((r) => ({ ...r, fluency: v }))}
              hintLow="very hesitant"
              hintHigh="very fluent"
            />
            <RatingSlider
              label="Confidence"
              value={ratings.confidence}
              onChange={(v) => setRatings((r) => ({ ...r, confidence: v }))}
              hintLow="uncomfortable"
              hintHigh="confident"
            />
            <RatingSlider
              label="Hesitations"
              value={ratings.hesitation}
              onChange={(v) => setRatings((r) => ({ ...r, hesitation: v }))}
              hintLow="many pauses"
              hintHigh="almost none"
            />
            <div className="flex justify-end">
              <button
                onClick={() => void uploadAndFinalize()}
                disabled={saving}
                className="btn-crimson rounded-lg px-5 py-2.5 disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? "Saving..." : "Next"} <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InteractiveDialogue — real back-and-forth AI dialogue with Web Speech API,
// continuous single MediaRecorder audio stream, and fallback support.
// ---------------------------------------------------------------------------

function InteractiveDialogue({
  openingLine,
  sessionTheme,
  cefrLevel,
  vocab,
  result,
  onFinish,
}: {
  openingLine: string;
  sessionTheme: string;
  cefrLevel: string;
  vocab?: string[];
  result: RecordingState | null;
  onFinish: (r: RecordingState) => void;
}) {
  const [turns, setTurns] = useState<DialogueTurn[]>([{ speaker: "ai", text: openingLine }]);
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [typedReply, setTypedReply] = useState("");
  const [finishing, setFinishing] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTsRef = useRef<number>(0);
  const finishedRef = useRef(false);

  const getReply = useServerFn(generateDialogueReply);
  const getHint = useServerFn(generateDialogueHint);

  const supportsSpeech = useMemo(() => getSpeechRecognitionCtor() !== null, []);
  const learnerTurnCount = turns.filter((t) => t.speaker === "learner").length;
  const canFinish = learnerTurnCount >= 2 && !finishing && !result;

  // Speak opening AI line and each subsequent AI turn
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last?.speaker === "ai" && typeof window !== "undefined" && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(last.text);
      u.lang = "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
  }, [turns]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      window.speechSynthesis?.cancel();
    };
  }, []);

  async function ensureRecorderStarted() {
    if (recorderRef.current) return;
    if (typeof MediaRecorder === "undefined") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.start();
      recorderRef.current = rec;
      startTsRef.current = Date.now();
    } catch {
      /* media stream permission denied or unavailable for recording */
    }
  }

  async function sendLearnerTurn(text: string) {
    const clean = text.trim();
    if (!clean) return;
    const nextTurns: DialogueTurn[] = [...turns, { speaker: "learner", text: clean }];
    setTurns(nextTurns);
    setHint(null);
    setTypedReply("");
    setThinking(true);
    try {
      const { text: reply } = await getReply({
        data: {
          history: nextTurns,
          theme: sessionTheme,
          level: cefrLevel as "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
          vocabularyWords: vocab,
        },
      });
      setTurns((prev) => [...prev, { speaker: "ai", text: reply }]);
    } catch {
      toast.error("Couldn't get a reply — try again.");
    } finally {
      setThinking(false);
    }
  }

  async function startListening() {
    await ensureRecorderStarted();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        interim += ev.results[i][0].transcript;
      }
      setInterimText(interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      setInterimText((current) => {
        if (current.trim()) void sendLearnerTurn(current);
        return "";
      });
    };
    recognitionRef.current = rec;
    setListening(true);
    setInterimText("");
    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
  }

  async function requestHint() {
    setHintLoading(true);
    try {
      const { starter } = await getHint({
        data: {
          history: turns,
          theme: sessionTheme,
          level: cefrLevel as "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
        },
      });
      setHint(starter);
    } catch {
      toast.error("Couldn't fetch a hint right now.");
    } finally {
      setHintLoading(false);
    }
  }

  function finishConversation() {
    setFinishing(true);
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      finishedRef.current = true;
      onFinish({
        blob: new Blob([], { type: "audio/webm" }),
        url: "",
        durationSec: 0,
        ratings: { fluency: 3, confidence: 3, hesitation: 3 },
        pinned: false,
        dialogueTurns: turns,
      });
      return;
    }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const durationSec = Math.round((Date.now() - startTsRef.current) / 1000);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      finishedRef.current = true;
      onFinish({
        blob,
        url,
        durationSec,
        ratings: { fluency: 3, confidence: 3, hesitation: 3 },
        pinned: false,
        dialogueTurns: turns,
      });
    };
    rec.stop();
  }

  const lastAiLine = [...turns].reverse().find((t) => t.speaker === "ai")?.text ?? "";

  return (
    <div className="space-y-4">
      {vocab && vocab.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <span className="label-mono text-muted-foreground self-center">Try to use:</span>
          {vocab.map((w) => (
            <button
              key={w}
              onClick={() => {
                const u = new SpeechSynthesisUtterance(w);
                u.lang = "en-US";
                window.speechSynthesis?.speak(u);
              }}
              className="text-xs px-2.5 py-1 rounded-full border border-[color:var(--color-crimson-glow)]/40 bg-[color:var(--color-crimson)]/10 text-[color:var(--color-gold)] hover:bg-[color:var(--color-crimson)]/20 transition flex items-center gap-1"
            >
              <Volume2 size={11} /> {w}
            </button>
          ))}
        </div>
      )}

      {/* Chat Bubbles */}
      <div className="glass-panel p-6 md:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <p className="label-mono">Interactive Conversation ({cefrLevel} · {sessionTheme})</p>
          <button
            onClick={() => setCaptionsOn((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition flex items-center gap-1.5"
            title={captionsOn ? "Hide captions" : "Show captions"}
          >
            <Subtitles size={14} /> {captionsOn ? "Captions on" : "Captions off"}
          </button>
        </div>

        <div className="space-y-3 max-h-72 overflow-y-auto custom-scrollbar pr-1">
          {turns.map((t, i) => (
            <div
              key={i}
              className={`flex ${t.speaker === "ai" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  t.speaker === "ai"
                    ? "bg-white/5 border border-[color:var(--color-border)] rounded-tl-sm text-foreground"
                    : "bg-[color:var(--color-crimson)]/25 border border-[color:var(--color-crimson-glow)]/40 text-white rounded-tr-sm shadow-[0_0_10px_rgba(237,28,36,0.15)]"
                } ${captionsOn ? "" : "blur-sm select-none"}`}
              >
                {t.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 bg-white/5 border border-[color:var(--color-border)] flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin text-[color:var(--color-gold)]" /> AI is thinking of a reply…
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            const u = new SpeechSynthesisUtterance(lastAiLine);
            u.lang = "en-US";
            window.speechSynthesis?.cancel();
            window.speechSynthesis?.speak(u);
          }}
          className="text-xs text-muted-foreground hover:text-[color:var(--color-gold)] transition flex items-center gap-1.5"
        >
          <Volume2 size={13} /> Replay last line
        </button>
      </div>

      {!result && (
        <div className="glass-panel p-6 flex flex-col items-center gap-4">
          {supportsSpeech ? (
            <>
              <button
                onClick={listening ? stopListening : () => void startListening()}
                disabled={thinking}
                className={`relative h-20 w-20 rounded-full flex items-center justify-center transition disabled:opacity-40 ${
                  listening
                    ? "bg-[color:var(--color-crimson)] text-white"
                    : "bg-[color:var(--color-crimson)]/80 hover:bg-[color:var(--color-crimson)] text-white shadow-[0_0_20px_rgba(237,28,36,0.3)]"
                }`}
                aria-label={listening ? "Stop and send" : "Speak your reply"}
              >
                {listening && (
                  <span className="absolute inset-0 rounded-full bg-[color:var(--color-crimson)] opacity-60 motion-reduce:hidden animate-ping" />
                )}
                <span className="relative z-10">
                  {listening ? <Square size={26} /> : <Mic size={26} />}
                </span>
              </button>
              <p className="text-sm text-muted-foreground text-center min-h-[20px]">
                {listening
                  ? interimText || "Listening…"
                  : "Press to speak your reply, then press again to send"}
              </p>
            </>
          ) : (
            <div className="w-full space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Speech recognition is not supported in this browser — speak your reply out loud, then type it below to continue.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void ensureRecorderStarted().finally(() => sendLearnerTurn(typedReply));
                }}
                className="flex gap-2"
              >
                <input
                  value={typedReply}
                  onChange={(e) => setTypedReply(e.target.value)}
                  placeholder="Type what you said…"
                  className="flex-1 glass-panel-soft px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[color:var(--color-crimson-glow)]"
                />
                <button
                  type="submit"
                  disabled={!typedReply.trim() || thinking}
                  className="btn-crimson rounded-lg px-4 py-2 text-sm disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => void requestHint()}
              disabled={hintLoading}
              className="text-xs rounded-lg px-3 py-1.5 border border-[color:var(--color-border)] hover:bg-white/5 flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
            >
              {hintLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Lightbulb size={13} />
              )}
              💡 Need a hint?
            </button>
            {canFinish && (
              <button
                onClick={finishConversation}
                disabled={finishing}
                className="text-xs rounded-lg px-3 py-1.5 border border-[color:var(--color-gold)]/50 text-[color:var(--color-gold)] bg-[color:var(--color-gold)]/10 hover:bg-[color:var(--color-gold)]/20 flex items-center gap-1.5 transition font-semibold"
              >
                <CheckCircle2 size={13} /> Finish conversation
              </button>
            )}
          </div>

          {hint && (
            <p className="text-xs text-[color:var(--color-gold)] italic text-center">"{hint}"</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rating slider
// ---------------------------------------------------------------------------

function RatingSlider({
  label,
  value,
  onChange,
  hintLow,
  hintHigh,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hintLow: string;
  hintHigh: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm font-mono text-[color:var(--color-gold)]">{value}/5</span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="fluency-slider w-full"
      />
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
        <span>{hintLow}</span>
        <span>{hintHigh}</span>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-panel-soft p-3 rounded-lg text-center">
      <div className="text-2xl font-bold text-[color:var(--color-gold)]">
        {value ? value.toFixed(1) : "–"}
      </div>
      <div className="label-mono mt-1">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers & hooks
// ---------------------------------------------------------------------------

function labelType(t: ExerciseType) {
  return t === "free_talk" ? "Free Talk" : t === "chunk_repeat" ? "Chunk Repeat" : "Dialogue";
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function averageRatings(recs: RecordingState[]) {
  if (recs.length === 0) return { fluency: 0, confidence: 0, hesitation: 0 };
  const sum = recs.reduce(
    (acc, r) => ({
      fluency: acc.fluency + r.ratings.fluency,
      confidence: acc.confidence + r.ratings.confidence,
      hesitation: acc.hesitation + r.ratings.hesitation,
    }),
    { fluency: 0, confidence: 0, hesitation: 0 },
  );
  return {
    fluency: sum.fluency / recs.length,
    confidence: sum.confidence / recs.length,
    hesitation: sum.hesitation / recs.length,
  };
}

async function loadChunksPool(): Promise<string[]> {
  const { data } = await supabase.from("lessons").select("content").limit(50);
  const out: string[] = [];
  for (const row of data ?? []) {
    const c = row.content as {
      collocations?: string[];
      relatedIdioms?: { phrase: string }[];
    } | null;
    if (!c) continue;
    if (Array.isArray(c.collocations)) out.push(...c.collocations);
    if (Array.isArray(c.relatedIdioms))
      out.push(...c.relatedIdioms.map((x) => x.phrase).filter(Boolean));
  }
  return Array.from(new Set(out.filter((s) => typeof s === "string" && s.length > 2)));
}

function useFluencyStreak() {
  return useQuery({
    queryKey: ["fluency-streak"],
    queryFn: async () => {
      const { data } = await supabase
        .from("fluency_sessions")
        .select("completed_at")
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(365);
      if (!data || data.length === 0) return 0;
      const days = new Set(
        data.map((r) => new Date(r.completed_at as string).toISOString().slice(0, 10)),
      );
      let streak = 0;
      const cursor = new Date();
      if (!days.has(cursor.toISOString().slice(0, 10))) {
        cursor.setDate(cursor.getDate() - 1);
        if (!days.has(cursor.toISOString().slice(0, 10))) return 0;
      }
      while (days.has(cursor.toISOString().slice(0, 10))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      }
      return streak;
    },
    staleTime: 60_000,
  });
}

function useCleanupExpired() {
  const qc = useQueryClient();
  useEffect(() => {
    (async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const { data } = await supabase
        .from("fluency_recordings")
        .select("id, storage_path")
        .eq("pinned", false)
        .not("storage_path", "is", null)
        .lt("created_at", cutoff.toISOString())
        .limit(50);
      if (!data || data.length === 0) return;
      const paths = data.map((r) => r.storage_path as string).filter(Boolean);
      if (paths.length) {
        await supabase.storage.from("fluency-recordings").remove(paths);
      }
      await supabase
        .from("fluency_recordings")
        .update({ storage_path: null })
        .in(
          "id",
          data.map((r) => r.id),
        );
      qc.invalidateQueries({ queryKey: ["fluency-journal"] });
    })().catch(() => {});
  }, [qc]);
}