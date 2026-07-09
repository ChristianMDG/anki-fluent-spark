import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { generateFluencyPrompt } from "@/lib/fluency.functions";
import {
  currentTheme,
  SESSION_CONFIG,
  type SessionLength,
} from "@/lib/fluency-themes";
import {
  SITUATION_META,
  COMPLEXITY_META,
  type JourneySituation,
} from "@/lib/journey";
import { z } from "zod";
import { Mic, Square, RotateCcw, Pin, BookOpen, Volume2, Flame, ChevronRight, Compass } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/fluency")({
  validateSearch: (s: Record<string, unknown>) =>
    z.object({ journeyCell: z.string().uuid().optional() }).parse(s),
  component: FluencyPage,
});

type ExerciseType = "free_talk" | "chunk_repeat" | "dialogue";

interface Exercise {
  type: ExerciseType;
  prompt: string; // text prompt for free_talk/dialogue; joined chunks for chunk_repeat
  chunks?: string[];
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

function FluencyPage() {
  const search = Route.useSearch();
  const journeyCellId = search.journeyCell;
  const theme = useMemo(() => currentTheme(), []);
  const [phase, setPhase] = useState<"entry" | "session" | "summary">("entry");
  const [length, setLength] = useState<SessionLength>("standard");
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
    const order: ExerciseType[] = ["free_talk", "chunk_repeat", "dialogue"];
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
          : [
              "on the other hand",
              "to be honest",
              "at the end of the day",
              "as far as I know",
            ];
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
          out.push({ type, prompt });
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
      />
    );
  }

  if (phase === "summary") {
    const avg = averageRatings(recordings);
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="glass-panel p-8 text-center space-y-4">
          <p className="label-mono text-[color:var(--color-gold)]">Session complète</p>
          <h1 className="text-3xl font-bold">Nicely done.</h1>
          <p className="text-muted-foreground">
            {recordings.length} exercice{recordings.length > 1 ? "s" : ""} enregistré
            {recordings.length > 1 ? "s" : ""}.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2">
            <SummaryStat label="Fluidité" value={avg.fluency} />
            <SummaryStat label="Confiance" value={avg.confidence} />
            <SummaryStat label="Hésitations" value={avg.hesitation} />
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
              Retour à l'accueil
            </button>
            <Link
              to="/fluency/journal"
              className="rounded-lg px-5 py-2.5 border border-[color:var(--color-border)] hover:bg-white/5"
            >
              Voir le journal
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
  onStart,
  starting,
  streak,
  journeyCell,
}: {
  theme: { title: string; description: string };
  length: SessionLength;
  setLength: (l: SessionLength) => void;
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
            Un module dédié à la fluidité orale et à la confiance à l'oral. Enregistre-toi, réécoute, mesure ta progression.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="glass-panel-soft px-4 py-2.5 rounded-lg flex items-center gap-2">
            <Flame size={18} className="text-orange-400" />
            <div>
              <div className="text-lg font-bold leading-none">{streak}</div>
              <div className="label-mono">jour{streak > 1 ? "s" : ""} d'affilée</div>
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
            <Compass size={14} /> Parcours · {sit.icon} {sit.label} — {cx.label}
          </div>
          <h2 className="text-2xl font-bold mt-2">{cx.description}</h2>
          <p className="text-muted-foreground mt-2">{sit.description}</p>
          <p className="text-sm text-muted-foreground mt-3">
            Progression : {journeyCell.sessionsCompleted}/5 sessions. Le vocabulaire déjà appris sera intégré aux exercices.
          </p>
          <Link
            to="/parcours"
            className="mt-3 inline-block text-xs text-muted-foreground underline hover:text-foreground"
          >
            ← Retour au Parcours
          </Link>
        </div>
      ) : (
        <div className="glass-panel p-6 md:p-8">
          <p className="label-mono">Thème de la semaine</p>
          <h2 className="text-2xl font-bold mt-1 text-[color:var(--color-gold)]">{theme.title}</h2>
          <p className="text-muted-foreground mt-2">{theme.description}</p>
        </div>
      )}

      <div>
        <p className="label-mono mb-3">Durée de la session</p>
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
                  {cfg.exerciseCount} exercice{cfg.exerciseCount > 1 ? "s" : ""} inclus
                </p>
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
          {starting ? "Préparation..." : "Commencer la session"} <ChevronRight size={18} />
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
}: {
  exercise: Exercise;
  sessionId: string;
  weekTheme: string;
  stepIndex: number;
  totalSteps: number;
  freeTalkSeconds: number;
  onComplete: (r: RecordingState) => void;
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
      toast.error("Ton navigateur ne supporte pas l'enregistrement audio.");
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
        "Micro refusé. Autorise l'accès au microphone dans les paramètres du navigateur pour continuer.",
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

  function retryRecording() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setElapsed(0);
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
      toast.error(
        e instanceof Error ? `Échec de l'upload : ${e.message}` : "Échec de l'upload",
      );
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
      <div className="flex items-center justify-between">
        <p className="label-mono">
          Exercice {stepIndex + 1} / {totalSteps}
        </p>
        <p className="label-mono text-[color:var(--color-gold)]">{labelType(exercise.type)}</p>
      </div>

      <div className="glass-panel p-6 md:p-8">
        {exercise.type === "chunk_repeat" && exercise.chunks ? (
          <div className="space-y-3">
            <p className="label-mono">Répète ces expressions à voix haute</p>
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
                    title="Écouter"
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
            aria-label={recording ? "Arrêter l'enregistrement" : "Démarrer l'enregistrement"}
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
                <span className="text-muted-foreground text-base"> / {formatTime(maxSeconds)}</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {recording ? "Enregistrement en cours…" : "Appuie pour démarrer"}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="glass-panel p-5 space-y-3">
            <p className="label-mono">Ta prise ({formatTime(result.durationSec)})</p>
            <audio src={result.url} controls className="w-full" />
            <div className="flex flex-wrap gap-2">
              <button
                onClick={retryRecording}
                className="rounded-lg px-3 py-2 border border-[color:var(--color-border)] hover:bg-white/5 text-sm flex items-center gap-2"
              >
                <RotateCcw size={14} /> Recommencer
              </button>
              <button
                onClick={togglePin}
                className={`rounded-lg px-3 py-2 border text-sm flex items-center gap-2 transition ${
                  result.pinned
                    ? "border-[color:var(--color-gold)] text-[color:var(--color-gold)]"
                    : "border-[color:var(--color-border)] hover:bg-white/5"
                }`}
              >
                <Pin size={14} /> {result.pinned ? "Épinglé" : "Épingler"}
              </button>
            </div>
          </div>

          <div className="glass-panel p-5 space-y-4">
            <p className="label-mono">Auto-évaluation</p>
            <RatingSlider
              label="Fluidité"
              value={ratings.fluency}
              onChange={(v) => setRatings((r) => ({ ...r, fluency: v }))}
              hintLow="très hésitant"
              hintHigh="très fluide"
            />
            <RatingSlider
              label="Confiance"
              value={ratings.confidence}
              onChange={(v) => setRatings((r) => ({ ...r, confidence: v }))}
              hintLow="mal à l'aise"
              hintHigh="confiant"
            />
            <RatingSlider
              label="Hésitations"
              value={ratings.hesitation}
              onChange={(v) => setRatings((r) => ({ ...r, hesitation: v }))}
              hintLow="beaucoup de blancs"
              hintHigh="quasi aucun"
            />
            <div className="flex justify-end">
              <button
                onClick={uploadAndFinalize}
                disabled={saving}
                className="btn-crimson rounded-lg px-5 py-2.5 disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? "Sauvegarde..." : "Suivant"} <ChevronRight size={16} />
              </button>
            </div>
          </div>
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
