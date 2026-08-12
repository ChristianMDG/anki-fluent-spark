import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { generateFluencyPrompt, generateDialogueReply, generateDialogueHint } from "@/lib/fluency.functions";
import { currentTheme, SESSION_CONFIG, type SessionLength } from "@/lib/fluency-themes";
import { SITUATION_META, COMPLEXITY_META, type JourneySituation } from "@/lib/journey";
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
  Compass,
  Lightbulb,
  Subtitles,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fluency/")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ journeyCell: z.string().uuid().optional() }).parse(s),
  component: FluencyPage,
});

type ExerciseType = "free_talk" | "chunk_repeat" | "dialogue";

interface Exercise {
  type: ExerciseType;
  prompt: string; // text prompt for free_talk/dialogue; joined chunks for chunk_repeat
  chunks?: string[];
  // Only populated for "dialogue" exercises — carried through so the
  // interactive conversation can keep generating replies in the right
  // situation/complexity/vocabulary context, not just for the opening line.
  situation?: JourneySituation;
  complexityLevel?: number;
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
}

type SessionMode = "mixed" | "free_talk" | "chunk_repeat" | "dialogue";

function FluencyPage() {
  const search = Route.useSearch();
  const journeyCellId = search.journeyCell;
  const theme = useMemo(() => currentTheme(), []);
  const [phase, setPhase] = useState<"entry" | "session" | "summary">("entry");
  const [length, setLength] = useState<SessionLength>("standard");
  const [sessionMode, setSessionMode] = useState<SessionMode>("mixed");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [recordings, setRecordings] = useState<RecordingState[]>([]);
  const [step, setStep] = useState(0);

  const streak = useFluencyStreak();
  const genPrompt = useServerFn(generateFluencyPrompt);
  const qc = useQueryClient();

  const { data: cell } = useQuery({
    queryKey: ["journey-cell", journeyCellId],
    enabled: !!journeyCellId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journey_cells")
        .select("*")
        .eq("id", journeyCellId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  async function pickVocabWords(situation: JourneySituation | null): Promise<string[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    let words: string[] = [];
    if (situation) {
      const { data } = await supabase
        .from("cards")
        .select("word")
        .contains("tags", [situation])
        .limit(20);
      words = (data ?? []).map((r) => r.word);
    }
    if (words.length < 3) {
      const { data } = await supabase
        .from("cards")
        .select("word")
        .order("created_at", { ascending: false })
        .limit(40);
      const extras = (data ?? []).map((r) => r.word).filter((w) => !words.includes(w));
      words = [...words, ...extras];
    }
    return shuffle(words).slice(0, Math.min(3, words.length));
  }

  async function buildExercises(count: number): Promise<Exercise[]> {
    // Map session mode to the exercise type(s) to cycle through.
    // "mixed" rotates all three; focused modes repeat their single type.
    const modeToOrder: Record<SessionMode, ExerciseType[]> = {
      mixed: ["free_talk", "chunk_repeat", "dialogue"],
      free_talk: ["free_talk"],
      chunk_repeat: ["chunk_repeat"],
      dialogue: ["dialogue"],
    };
    const order: ExerciseType[] = modeToOrder[sessionMode];
    const chunks = await loadChunksPool();
    const situation = (cell?.situation ?? null) as JourneySituation | null;
    const complexityLevel = cell?.complexity_level ?? undefined;
    const vocab = cell ? await pickVocabWords(situation) : [];
    const out: Exercise[] = [];
    for (let i = 0; i < count; i++) {
      const type = order[i % order.length];
      if (type === "chunk_repeat") {
        const picked = chunks.length
          ? shuffle(chunks).slice(0, Math.min(5, Math.max(3, chunks.length)))
          : ["on the other hand", "to be honest", "at the end of the day", "as far as I know"];
        out.push({ type, prompt: picked.join(" • "), chunks: picked });
      } else {
        try {
          const { prompt } = await genPrompt({
            data: {
              type,
              weekTheme: theme.title,
              ...(situation ? { situation } : {}),
              ...(complexityLevel ? { complexityLevel } : {}),
              ...(vocab.length ? { vocabularyWords: vocab } : {}),
            },
          });
          out.push({
            type,
            prompt,
            ...(type === "dialogue"
              ? {
                  situation: situation ?? undefined,
                  complexityLevel,
                  vocab,
                }
              : {}),
          });
        } catch (e) {
          out.push({
            type,
            prompt:
              type === "free_talk"
                ? `Talk for a minute about something related to: ${theme.title}.`
                : `So, what did you get up to this week?`,
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
          week_theme: cell
            ? `${SITUATION_META[cell.situation as JourneySituation].label} · ${COMPLEXITY_META[cell.complexity_level].label}`
            : theme.title,
          journey_cell_id: journeyCellId ?? null,
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
    if (cell) {
      await supabase
        .from("journey_cells")
        .update({ sessions_completed: (cell.sessions_completed ?? 0) + 1 })
        .eq("id", cell.id);
      qc.invalidateQueries({ queryKey: ["journey-cells"] });
      qc.invalidateQueries({ queryKey: ["journey-cell", cell.id] });
    }
    setPhase("summary");
  }

  if (phase === "entry") {
    return (
      <FluencyEntry
        theme={theme}
        length={length}
        setLength={setLength}
        sessionMode={sessionMode}
        setSessionMode={setSessionMode}
        onStart={() => startSession.mutate()}
        starting={startSession.isPending}
        streak={streak.data ?? 0}
        journeyCell={
          cell
            ? {
                situation: cell.situation as JourneySituation,
                complexityLevel: cell.complexity_level,
                sessionsCompleted: cell.sessions_completed ?? 0,
              }
            : null
        }
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
        weekTheme={theme.title}
        stepIndex={step}
        totalSteps={exercises.length}
        freeTalkSeconds={SESSION_CONFIG[length].freeTalkSeconds}
        onComplete={(rec) => {
          setRecordings((prev) => [...prev, rec]);
          if (step + 1 < exercises.length) setStep(step + 1);
          else finishSession();
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
              Back to Home
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

// ---------- Entry ----------
function FluencyEntry({
  theme,
  length,
  setLength,
  sessionMode,
  setSessionMode,
  onStart,
  starting,
  streak,
  journeyCell,
}: {
  theme: { title: string; description: string };
  length: SessionLength;
  setLength: (l: SessionLength) => void;
  sessionMode: SessionMode;
  setSessionMode: (m: SessionMode) => void;
  onStart: () => void;
  starting: boolean;
  streak: number;
  journeyCell: {
    situation: JourneySituation;
    complexityLevel: number;
    sessionsCompleted: number;
  } | null;
}) {
  useCleanupExpired();
  const sit = journeyCell ? SITUATION_META[journeyCell.situation] : null;
  const cx = journeyCell ? COMPLEXITY_META[journeyCell.complexityLevel] : null;
  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Fluency Practice</p>
          <h1 className="text-3xl md:text-4xl font-bold mt-1">Speak like a native.</h1>
          <p className="text-muted-foreground mt-2 max-w-xl">
            A module dedicated to speaking fluency and oral confidence. Record yourself,
            listen back, and measure your progress.
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

      {journeyCell && sit && cx ? (
        <div className="glass-panel p-6 md:p-8 border-[color:var(--color-crimson-glow)]">
          <div className="flex items-center gap-2 label-mono text-[color:var(--color-crimson-glow)]">
            <Compass size={14} /> Path · {sit.icon} {sit.label} — {cx.label}
          </div>
          <h2 className="text-2xl font-bold mt-2">{cx.description}</h2>
          <p className="text-muted-foreground mt-2">{sit.description}</p>
          <p className="text-sm text-muted-foreground mt-3">
            Progress: {journeyCell.sessionsCompleted}/5 sessions. The vocabulary already learned
            will be integrated into the exercises.
          </p>
          <Link
            to="/parcours"
            className="mt-3 inline-block text-xs text-muted-foreground underline hover:text-foreground"
          >
            ← Back to Path
          </Link>
        </div>
      ) : (
        <div className="glass-panel p-6 md:p-8">
          <p className="label-mono">Weekly Theme</p>
          <h2 className="text-2xl font-bold mt-1 text-[color:var(--color-gold)]">{theme.title}</h2>
          <p className="text-muted-foreground mt-2">{theme.description}</p>
        </div>
      )}

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
                    ? "border-[color:var(--color-crimson-glow)] -translate-y-0.5"
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

      <div>
        <p className="label-mono mb-3">Session Type</p>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          {(
            [
              {
                key: "mixed" as const,
                label: "Mixed",
                desc: "Rotates through Free Talk, Chunk Repeat, and Dialogue.",
              },
              {
                key: "free_talk" as const,
                label: "Free Talk only",
                desc: "Every exercise is an open-ended speaking prompt.",
              },
              {
                key: "chunk_repeat" as const,
                label: "Chunk Repeat only",
                desc: "Every exercise is a set of expressions to repeat aloud.",
              },
              {
                key: "dialogue" as const,
                label: "Dialogue only",
                desc: "Real back-and-forth AI conversation — speak and get a natural reply.",
              },
            ] as const
          ).map((m) => {
            const active = sessionMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setSessionMode(m.key)}
                className={`glass-panel p-5 text-left transition ${
                  active
                    ? "border-[color:var(--color-crimson-glow)] -translate-y-0.5"
                    : "hover:-translate-y-0.5"
                }`}
              >
                <div className="text-lg font-semibold">{m.label}</div>
                <p className="text-sm text-muted-foreground mt-1">{m.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onStart}
          disabled={starting}
          className="btn-crimson rounded-lg px-6 py-3 text-base font-semibold flex items-center gap-2 disabled:opacity-50"
        >
          {starting ? "Preparing..." : "Start Session"} <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ---------- Session runner ----------
function SessionRunner({
  exercise,
  sessionId,
  weekTheme,
  stepIndex,
  totalSteps,
  freeTalkSeconds,
  onComplete,
  onBack,
}: {
  exercise: Exercise;
  sessionId: string;
  weekTheme: string;
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
    } catch (err) {
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
    // Recording in progress or an unsaved take sitting in the review step
    // would be silently discarded by navigating away — confirm first so a
    // stray click doesn't lose audio the person just recorded.
    if (recording || result) {
      const ok = window.confirm(
        "You have an unsaved recording for this exercise. Going back will discard it. Continue?",
      );
      if (!ok) return;
      if (recording) stopRecording();
    }
    onBack();
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

      if (!storagePath) {
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
            week_theme: weekTheme,
            storage_path: storagePath,
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

      onComplete({ ...result, storagePath, recordingId, ratings });
    } catch (e) {
      toast.error(e instanceof Error ? `Upload failed: ${e.message}` : "Upload failed");
      // keep result so user can retry
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
        // Real back-and-forth conversation: the browser transcribes what the
        // learner says (SpeechRecognition), the AI replies naturally
        // (generateDialogueReply) and speaks it (SpeechSynthesis) — instead
        // of reacting once to a single static line. Internally records
        // continuous audio for the journal/rating flow below, exactly like
        // the other exercise types once it hands back a result.
        <InteractiveDialogue
          key={`${exercise.prompt}:${dialogueRetryKey}`}
          openingLine={exercise.prompt}
          situation={exercise.situation}
          complexityLevel={exercise.complexityLevel}
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
                <p className="label-mono">Prompt</p>
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
                  <span className="absolute inset-0 rounded-full bg-[color:var(--color-crimson)] opacity-60 motion-safe:animate-ping" />
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
            <audio src={result.url} controls className="w-full" />
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
                onClick={uploadAndFinalize}
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
// InteractiveDialogue — a real spoken back-and-forth instead of a single
// static prompt. The browser transcribes the learner's speech, the AI
// generates a natural follow-up line and speaks it, and the whole exchange
// is recorded as one continuous take for the journal/rating flow shared
// with the other exercise types (via `onFinish`).
// ---------------------------------------------------------------------------

interface DialogueTurn {
  speaker: "ai" | "learner";
  text: string;
}

// Minimal shape of the non-standard Web Speech API (webkit-prefixed in most
// browsers, absent in Safari/Firefox at the time of writing) — kept narrow
// and local instead of `any` so the fallback path stays type-safe.
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function InteractiveDialogue({
  openingLine,
  situation,
  complexityLevel,
  vocab,
  result,
  onFinish,
}: {
  openingLine: string;
  situation?: JourneySituation;
  complexityLevel?: number;
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

  // Speak each new AI line as it arrives.
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last?.speaker === "ai" && typeof window !== "undefined" && window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(last.text);
      u.lang = "en-US";
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.start();
    recorderRef.current = rec;
    startTsRef.current = Date.now();
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
        data: { history: nextTurns, situation, complexityLevel, vocabularyWords: vocab },
      });
      setTurns((prev) => [...prev, { speaker: "ai", text: reply }]);
    } catch {
      toast.error("Couldn't get a reply — try again.");
    } finally {
      setThinking(false);
    }
  }

  async function startListening() {
    try {
      await ensureRecorderStarted();
    } catch {
      toast.error("Mic access denied. Allow microphone access in your browser settings.");
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return; // handled by the typed-reply fallback UI instead
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i][0];
        // Heuristic: the Web Speech API marks finality on the result item,
        // not exposed in this narrow type — treat the last chunk as final
        // once recognition ends instead of relying on `.isFinal` typing.
        interim += r.transcript;
      }
      finalText = interim;
      setInterimText(finalText);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      setInterimText((current) => {
        if (current.trim()) sendLearnerTurn(current);
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
      const { starter } = await getHint({ data: { history: turns } });
      setHint(starter);
    } catch {
      toast.error("Couldn't fetch a hint right now.");
    } finally {
      setHintLoading(false);
    }
  }

  async function finishConversation() {
    setFinishing(true);
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
    const rec = recorderRef.current;
    if (!rec || rec.state === "inactive") {
      // Nothing was ever recorded (e.g. mic never granted) — still let the
      // learner move on with an empty placeholder rather than getting stuck.
      finishedRef.current = true;
      onFinish({
        blob: new Blob([], { type: "audio/webm" }),
        url: "",
        durationSec: 0,
        ratings: { fluency: 3, confidence: 3, hesitation: 3 },
        pinned: false,
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

      <div className="glass-panel p-6 md:p-8 space-y-4">
        <div className="flex items-center justify-between">
          <p className="label-mono">Conversation</p>
          <button
            onClick={() => setCaptionsOn((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition flex items-center gap-1.5"
            title={captionsOn ? "Hide captions" : "Show captions"}
          >
            <Subtitles size={14} /> {captionsOn ? "Captions on" : "Captions off"}
          </button>
        </div>

        <div className="space-y-2.5 max-h-64 overflow-y-auto custom-scrollbar pr-1">
          {turns.map((t, i) => (
            <div
              key={i}
              className={`flex ${t.speaker === "ai" ? "justify-start" : "justify-end"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  t.speaker === "ai"
                    ? "bg-white/5 border border-[color:var(--color-border)] rounded-tl-sm"
                    : "bg-[color:var(--color-crimson)]/25 border border-[color:var(--color-crimson-glow)]/30 rounded-tr-sm"
                } ${captionsOn ? "" : "blur-sm select-none"}`}
              >
                {t.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-tl-sm px-4 py-2 bg-white/5 border border-[color:var(--color-border)]">
                <Loader2 size={14} className="animate-spin text-muted-foreground" />
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
                onClick={listening ? stopListening : startListening}
                disabled={thinking}
                className={`relative h-20 w-20 rounded-full flex items-center justify-center transition disabled:opacity-40 ${
                  listening
                    ? "bg-[color:var(--color-crimson)] text-white"
                    : "bg-[color:var(--color-crimson)]/80 hover:bg-[color:var(--color-crimson)] text-white"
                }`}
                aria-label={listening ? "Stop and send" : "Speak your reply"}
              >
                {listening && (
                  <span className="absolute inset-0 rounded-full bg-[color:var(--color-crimson)] opacity-60 motion-safe:animate-ping" />
                )}
                <span className="relative z-10">
                  {listening ? <Square size={26} /> : <Mic size={26} />}
                </span>
              </button>
              <p className="text-sm text-muted-foreground text-center min-h-[20px]">
                {listening
                  ? interimText || "Listening…"
                  : "Press and speak your reply, then press again to send"}
              </p>
            </>
          ) : (
            <div className="w-full space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Your browser doesn't support voice recognition — speak your reply out loud, then
                type it below to continue.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  ensureRecorderStarted().finally(() => sendLearnerTurn(typedReply));
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
              onClick={requestHint}
              disabled={hintLoading}
              className="text-xs rounded-lg px-3 py-1.5 border border-[color:var(--color-border)] hover:bg-white/5 flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition disabled:opacity-50"
            >
              {hintLoading ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Lightbulb size={13} />
              )}
              Need a hint?
            </button>
            {canFinish && (
              <button
                onClick={finishConversation}
                disabled={finishing}
                className="text-xs rounded-lg px-3 py-1.5 border border-[color:var(--color-gold)]/40 text-[color:var(--color-gold)] hover:bg-[color:var(--color-gold)]/10 flex items-center gap-1.5 transition"
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

// ---------- Helpers & hooks ----------
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
      // If today not present, start from yesterday
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