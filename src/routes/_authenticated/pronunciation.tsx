import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PRONUNCIATION_CATEGORIES,
  PRONUNCIATION_CHALLENGES,
  getChallengesForCategory,
  type PronunciationChallenge,
  type CategoryInfo,
} from "@/lib/pronunciation-challenges";
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech";
import { PitchContourChart } from "@/components/fluency/PitchContourChart";
import {
  Volume2,
  Mic,
  MicOff,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Play,
  Pause,
  ArrowRight,
  Sparkles,
  Info,
  ChevronLeft,
  Activity,
  Music,
  Wind,
  Smile,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Route Definition
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/pronunciation")({
  component: PronunciationPage,
});

// ---------------------------------------------------------------------------
// DB Types & Progress Hook
// ---------------------------------------------------------------------------

interface CategoryProgressRow {
  category: string;
  clear_count: number;
  confusable_count: number;
}

function usePronunciationProgress() {
  return useQuery({
    queryKey: ["pronunciation-progress"],
    queryFn: async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return {};

        const { data, error } = await supabase
          .from("pronunciation_progress")
          .select("category, clear_count, confusable_count")
          .eq("user_id", user.id);

        if (error || !data) return {};

        const map: Record<string, { clear: number; confusable: number }> = {};
        for (const row of data as CategoryProgressRow[]) {
          map[row.category] = {
            clear: row.clear_count ?? 0,
            confusable: row.confusable_count ?? 0,
          };
        }
        return map;
      } catch {
        return {};
      }
    },
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

type ViewMode = "setup" | "session" | "summary";

function PronunciationPage() {
  const [view, setView] = useState<ViewMode>("setup");
  const [selectedCategory, setSelectedCategory] = useState<string>("th_sounds");
  const [sessionLength, setSessionLength] = useState<number>(8);
  const [activeChallenges, setActiveChallenges] = useState<PronunciationChallenge[]>([]);

  // Session results summary state
  const [sessionSummary, setSessionSummary] = useState<{
    clear: number;
    confusable: number;
    inconclusive: number;
    total: number;
  }>({ clear: 0, confusable: 0, inconclusive: 0, total: 0 });

  function handleStartSession() {
    const items = getChallengesForCategory(selectedCategory, sessionLength);
    if (items.length === 0) {
      toast.error("No challenges found for this category.");
      return;
    }
    setActiveChallenges(items);
    setView("session");
  }

  function handleFinishSession(summary: { clear: number; confusable: number; inconclusive: number; total: number }) {
    setSessionSummary(summary);
    setView("summary");
  }

  function handleReturnToSetup() {
    setView("setup");
  }

  if (view === "session" && activeChallenges.length > 0) {
    return (
      <PronunciationSession
        challenges={activeChallenges}
        onComplete={handleFinishSession}
        onExit={handleReturnToSetup}
      />
    );
  }

  if (view === "summary") {
    return (
      <PronunciationSummary
        summary={sessionSummary}
        onRestart={handleStartSession}
        onBackToSetup={handleReturnToSetup}
      />
    );
  }

  return (
    <PronunciationSetup
      selectedCategory={selectedCategory}
      onSelectCategory={setSelectedCategory}
      sessionLength={sessionLength}
      onSelectLength={setSessionLength}
      onStart={handleStartSession}
    />
  );
}

// ===========================================================================
// SETUP VIEW
// ===========================================================================

interface SetupProps {
  selectedCategory: string;
  onSelectCategory: (catId: string) => void;
  sessionLength: number;
  onSelectLength: (len: number) => void;
  onStart: () => void;
}

function getCategoryIcon(iconName: string) {
  switch (iconName) {
    case "Volume2":
      return <Volume2 size={20} className="text-amber-400" />;
    case "Music":
      return <Music size={20} className="text-emerald-400" />;
    case "Mic":
      return <Mic size={20} className="text-cyan-400" />;
    case "Wind":
      return <Wind size={20} className="text-purple-400" />;
    case "Smile":
      return <Smile size={20} className="text-pink-400" />;
    case "Activity":
      return <Activity size={20} className="text-red-400" />;
    default:
      return <Volume2 size={20} className="text-amber-400" />;
  }
}

function PronunciationSetup({
  selectedCategory,
  onSelectCategory,
  sessionLength,
  onSelectLength,
  onStart,
}: SetupProps) {
  const { data: progressMap = {} } = usePronunciationProgress();

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 label-mono text-[var(--color-gold)]">
          <Sparkles size={16} /> PRONUNCIATION COACH
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Targeted English Pronunciation Drills
        </h1>
        <p className="text-sm text-neutral-400 max-w-2xl leading-relaxed">
          Master the specific sounds French speakers commonly struggle with in English. Practice
          repetitively with reference audio, dual speech recognition feedback, and pitch contour visualization.
        </p>
      </div>

      {/* Honest Proxy Disclaimer Banner */}
      <div className="glass-panel p-4 border border-amber-500/30 rounded-2xl flex items-start gap-3 bg-amber-500/5 text-xs text-amber-200/90">
        <Info size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-300">Honest Feedback Mechanism</p>
          <p className="leading-relaxed">
            This module uses speech recognition as a practical proxy (showing what the recognizer understood).
            It identifies whether your pronunciation matches the target word or slips into a common confusable pair.
            Practice freely with unlimited retries on every word!
          </p>
        </div>
      </div>

      {/* Category Selection */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">1. Select a Sound Category</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRONUNCIATION_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const stats = progressMap[cat.id];
            const clear = stats?.clear ?? 0;
            const confusable = stats?.confusable ?? 0;
            const total = clear + confusable;

            return (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`glass-panel p-5 rounded-2xl text-left flex flex-col justify-between transition-all duration-300 relative border ${
                  isSelected
                    ? "border-[var(--color-crimson)] shadow-[0_0_25px_rgba(237,28,36,0.25)] bg-[var(--color-crimson)]/10"
                    : "border-white/10 hover:border-white/20 hover:bg-white/5"
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                      {getCategoryIcon(cat.iconName)}
                    </div>
                    {total > 0 && (
                      <span className="label-mono text-[10px] text-[var(--color-gold)]">
                        {clear}/{total} clear
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-white text-base">{cat.label}</h3>
                  <p className="text-xs text-neutral-400 leading-normal">{cat.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                  <span className="text-neutral-500 font-mono text-[10px]">
                    {PRONUNCIATION_CHALLENGES.filter((c) => c.category === cat.id).length} words
                  </span>
                  <span
                    className={`font-semibold text-xs ${
                      isSelected ? "text-[var(--color-gold)]" : "text-neutral-400"
                    }`}
                  >
                    {isSelected ? "Selected ✓" : "Select"}
                  </span>
                </div>
              </button>
            );
          })}

          {/* Mixed Challenge */}
          <button
            onClick={() => onSelectCategory("mixed")}
            className={`glass-panel p-5 rounded-2xl text-left flex flex-col justify-between transition-all duration-300 relative border ${
              selectedCategory === "mixed"
                ? "border-[var(--color-crimson)] shadow-[0_0_25px_rgba(237,28,36,0.25)] bg-[var(--color-crimson)]/10"
                : "border-white/10 hover:border-white/20 hover:bg-white/5"
            }`}
          >
            <div className="space-y-2">
              <div className="p-2 rounded-xl bg-white/5 border border-white/10 w-fit">
                <Sparkles size={20} className="text-amber-400" />
              </div>
              <h3 className="font-semibold text-white text-base">Mixed Challenge</h3>
              <p className="text-xs text-neutral-400 leading-normal">
                Cycle through a random blend of all 6 pronunciation categories in a single practice run.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
              <span className="text-neutral-500 font-mono text-[10px]">All categories</span>
              <span
                className={`font-semibold text-xs ${
                  selectedCategory === "mixed" ? "text-[var(--color-gold)]" : "text-neutral-400"
                }`}
              >
                {selectedCategory === "mixed" ? "Selected ✓" : "Select"}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Session Length */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-white">2. Session Length</h2>
        <div className="flex items-center gap-3">
          {[8, 12, 16].map((len) => (
            <button
              key={len}
              onClick={() => onSelectLength(len)}
              className={`px-5 py-2.5 rounded-xl border text-xs font-semibold font-mono transition-all ${
                sessionLength === len
                  ? "bg-[var(--color-crimson)] text-white border-[var(--color-crimson)] shadow-md"
                  : "bg-white/5 border-white/10 text-neutral-400 hover:text-white hover:bg-white/10"
              }`}
            >
              {len} Words
            </button>
          ))}
        </div>
      </div>

      {/* Action CTA */}
      <div className="pt-2">
        <button
          onClick={onStart}
          className="btn-crimson font-audiowide text-sm tracking-wider uppercase px-8 py-3.5 rounded-xl shadow-[0_4px_25px_rgba(237,28,36,0.3)] hover:shadow-[0_4px_35px_rgba(237,28,36,0.5)] transition-all flex items-center gap-3"
        >
          <span>🚀 Start Practice Session</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// SESSION DRILL VIEW
// ===========================================================================

interface SessionProps {
  challenges: PronunciationChallenge[];
  onComplete: (summary: { clear: number; confusable: number; inconclusive: number; total: number }) => void;
  onExit: () => void;
}

type EvalResultType = "clear" | "confusable" | "inconclusive" | null;

function PronunciationSession({ challenges, onComplete, onExit }: SessionProps) {
  const qc = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentChallenge = challenges[currentIndex];

  // Speech Recognition & Recording states
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>("");
  const [evalResult, setEvalResult] = useState<EvalResultType>(null);
  const [speechSupported, setSpeechSupported] = useState<boolean>(true);

  // Audio Playback state
  const [isPlayingRecord, setIsPlayingRecord] = useState(false);
  const audioElemRef = useRef<HTMLAudioElement | null>(null);

  // References
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Session stats tracking
  const resultsRef = useRef<{ clear: number; confusable: number; inconclusive: number }>({
    clear: 0,
    confusable: 0,
    inconclusive: 0,
  });

  // Check browser speech recognition support
  useEffect(() => {
    const ctor = getSpeechRecognitionCtor();
    setSpeechSupported(ctor !== null);
  }, []);

  // Cleanup audio URL on change
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Reset state for new word
  const resetWordState = useCallback(() => {
    setIsRecording(false);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setTranscript("");
    setEvalResult(null);
    setIsPlayingRecord(false);
  }, [audioUrl]);

  // Reference Audio Playback (SpeechSynthesis)
  function playReferenceAudio() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      toast.error("Speech synthesis is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentChallenge.targetWord);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  // Update DB progress
  async function recordResultInDB(cat: string, resultType: "clear" | "confusable") {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: existing } = await supabase
        .from("pronunciation_progress")
        .select("*")
        .eq("user_id", user.id)
        .eq("category", cat)
        .maybeSingle();

      const clearCount = (existing?.clear_count ?? 0) + (resultType === "clear" ? 1 : 0);
      const confusableCount = (existing?.confusable_count ?? 0) + (resultType === "confusable" ? 1 : 0);

      await supabase.from("pronunciation_progress").upsert(
        {
          user_id: user.id,
          category: cat,
          clear_count: clearCount,
          confusable_count: confusableCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,category" },
      );

      qc.invalidateQueries({ queryKey: ["pronunciation-progress"] });
    } catch {
      // ignore
    }
  }

  // Start Dual Recording & Recognition
  async function startRecording() {
    resetWordState();
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);

      // Start Speech Recognition if supported
      const RecognitionCtor = getSpeechRecognitionCtor();
      if (RecognitionCtor) {
        const recognition = new RecognitionCtor();
        recognition.lang = "en-US";
        recognition.interimResults = false;
        recognition.maxAlternatives = 3;

        let capturedTranscript = "";

        recognition.onresult = (ev) => {
          const res = ev.results[ev.resultIndex];
          if (res && res[0]) {
            capturedTranscript = res[0].transcript.trim().toLowerCase();
          }
        };

        recognition.onend = () => {
          setTranscript(capturedTranscript);
          evaluateTranscript(capturedTranscript);
        };

        recognition.onerror = () => {
          setTranscript(capturedTranscript);
          evaluateTranscript(capturedTranscript);
        };

        recognitionRef.current = recognition;
        recognition.start();
      }
    } catch {
      toast.error("Could not access microphone.");
      setIsRecording(false);
    }
  }

  // Stop Recording
  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsRecording(false);
  }

  // Evaluate Transcript Against Target & Confusable Pair
  function evaluateTranscript(rawTranscript: string) {
    const clean = rawTranscript.trim().toLowerCase();
    const target = currentChallenge.targetWord.toLowerCase();
    const confusable = currentChallenge.confusablePair?.toLowerCase();

    if (!clean) {
      setEvalResult("inconclusive");
      resultsRef.current.inconclusive++;
      return;
    }

    if (clean === target || clean.includes(target)) {
      setEvalResult("clear");
      resultsRef.current.clear++;
      void recordResultInDB(currentChallenge.category, "clear");
    } else if (confusable && (clean === confusable || clean.includes(confusable))) {
      setEvalResult("confusable");
      resultsRef.current.confusable++;
      void recordResultInDB(currentChallenge.category, "confusable");
    } else {
      setEvalResult("inconclusive");
      resultsRef.current.inconclusive++;
    }
  }

  // Next Word handler
  function handleNextWord() {
    if (currentIndex < challenges.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      resetWordState();
    } else {
      onComplete({
        ...resultsRef.current,
        total: challenges.length,
      });
    }
  }

  // Listen back to recorded take
  function togglePlayRecord() {
    if (!audioUrl) return;
    if (!audioElemRef.current) {
      audioElemRef.current = new Audio(audioUrl);
      audioElemRef.current.onended = () => setIsPlayingRecord(false);
    }
    if (isPlayingRecord) {
      audioElemRef.current.pause();
      setIsPlayingRecord(false);
    } else {
      audioElemRef.current.play();
      setIsPlayingRecord(true);
    }
  }

  const progressPercent = Math.round(((currentIndex + 1) / challenges.length) * 100);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Session Top Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition px-2.5 py-1.5 rounded-lg hover:bg-white/10"
        >
          <ChevronLeft size={16} /> <span>Exit Session</span>
        </button>

        <div className="flex items-center gap-2">
          <span className="label-mono text-[10px] text-neutral-400">WORD</span>
          <span className="label-mono text-xs text-[var(--color-gold)] font-bold">
            {currentIndex + 1} / {challenges.length}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--color-crimson)] via-[var(--color-gold)] to-emerald-400 transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Target Word Main Card */}
      <div className="glass-panel p-8 rounded-3xl text-center space-y-6 border border-white/10 relative overflow-hidden">
        {/* Category Tag */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-[var(--color-gold)]">
          <span>{currentChallenge.categoryLabel}</span>
        </div>

        {/* Word + IPA */}
        <div className="space-y-2">
          <h2 className="text-5xl font-black text-white tracking-tight">
            {currentChallenge.targetWord}
          </h2>
          <p className="text-lg font-mono text-amber-300/80">{currentChallenge.ipa}</p>
        </div>

        {/* Reference Audio Button */}
        <div className="flex justify-center">
          <button
            onClick={playReferenceAudio}
            className="btn-crimson font-audiowide text-xs tracking-wider uppercase px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-lg transition-all"
          >
            <Volume2 size={16} />
            <span>Hear Reference</span>
          </button>
        </div>

        {/* Static Articulation Tip (always accessible) */}
        <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-300 text-left flex items-start gap-2.5">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <span className="font-semibold text-amber-300">Articulation Tip:</span> {currentChallenge.tip}
          </p>
        </div>

        {/* Recording Controls */}
        <div className="pt-2 space-y-4">
          <div className="flex justify-center gap-3">
            {!isRecording ? (
              <button
                onClick={startRecording}
                className="px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-500 text-white font-semibold text-sm flex items-center gap-2 shadow-[0_0_20px_rgba(220,38,38,0.4)] transition-all cursor-pointer"
              >
                <Mic size={18} />
                <span>🎙️ Say it</span>
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm flex items-center gap-2 shadow-[0_0_20px_rgba(245,158,11,0.4)] transition-all animate-pulse cursor-pointer"
              >
                <MicOff size={18} />
                <span>Stop Recording…</span>
              </button>
            )}
          </div>

          {/* Feedback Card */}
          {evalResult && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-3">
              {evalResult === "clear" && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-3 text-left">
                  <CheckCircle2 size={22} className="text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-bold text-sm">Nice — that sounded right!</p>
                    <p className="text-emerald-400/80 mt-0.5">
                      The speech recognizer understood "{currentChallenge.targetWord}" clearly.
                    </p>
                  </div>
                </div>
              )}

              {evalResult === "confusable" && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-3 text-left">
                  <AlertTriangle size={22} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-sm">
                      Recognition heard "{currentChallenge.confusablePair}"
                    </p>
                    <p className="text-amber-200/90 leading-relaxed">{currentChallenge.tip}</p>
                  </div>
                </div>
              )}

              {evalResult === "inconclusive" && (
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-neutral-300 text-xs flex items-center gap-3 text-left">
                  <HelpCircle size={22} className="text-neutral-400 shrink-0" />
                  <div>
                    <p className="font-bold text-sm">Not quite clear — want to try again?</p>
                    {transcript && (
                      <p className="text-neutral-400 mt-0.5">
                        Recognized: <span className="font-mono text-amber-300">"{transcript}"</span>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Fallback note if SpeechRecognition unsupported */}
          {!speechSupported && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-400 text-left">
              ℹ️ Speech recognition is unavailable in this browser. You can still record your take, listen back, and review the pitch chart below!
            </div>
          )}

          {/* Audio Take Playback Button */}
          {audioUrl && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={togglePlayRecord}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs text-white flex items-center gap-2 border border-white/10 transition"
              >
                {isPlayingRecord ? <Pause size={14} /> : <Play size={14} />}
                <span>{isPlayingRecord ? "Pause Take" : "Listen to My Take"}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Pitch Contour Chart (Reused from Fluency Practice for Word Stress & Pitch Feedback) */}
      {audioBlob && (
        <div className="animate-in fade-in duration-300">
          <PitchContourChart blob={audioBlob} />
        </div>
      )}

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={resetWordState}
          className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 transition"
        >
          <RotateCcw size={14} />
          <span>🔁 Try Again</span>
        </button>

        <button
          onClick={handleNextWord}
          className="btn-crimson font-audiowide text-xs tracking-wider uppercase px-6 py-2.5 rounded-xl flex items-center gap-2 shadow-lg"
        >
          <span>{currentIndex < challenges.length - 1 ? "Next Word →" : "Finish Session 🎉"}</span>
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// SUMMARY VIEW
// ===========================================================================

interface SummaryProps {
  summary: { clear: number; confusable: number; inconclusive: number; total: number };
  onRestart: () => void;
  onBackToSetup: () => void;
}

function PronunciationSummary({ summary, onRestart, onBackToSetup }: SummaryProps) {
  const clearPercent = summary.total > 0 ? Math.round((summary.clear / summary.total) * 100) : 0;

  return (
    <div className="max-w-xl mx-auto space-y-6 text-center animate-in fade-in duration-300 py-8">
      <div className="glass-panel p-8 rounded-3xl space-y-6 border border-white/10">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400">
          <Sparkles size={32} />
        </div>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-white">Practice Session Complete!</h2>
          <p className="text-sm text-neutral-400">
            Great effort on targeting these English sounds. Consistency is key to muscle memory.
          </p>
        </div>

        {/* Score Stats */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-center">
            <p className="text-2xl font-bold text-emerald-300">{summary.clear}</p>
            <p className="text-[10px] font-mono text-emerald-400/80 uppercase">Clear Matches</p>
          </div>

          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-center">
            <p className="text-2xl font-bold text-amber-300">{summary.confusable}</p>
            <p className="text-[10px] font-mono text-amber-400/80 uppercase">Confusables</p>
          </div>

          <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 text-center">
            <p className="text-2xl font-bold text-neutral-300">{summary.inconclusive}</p>
            <p className="text-[10px] font-mono text-neutral-400 uppercase">Inconclusive</p>
          </div>
        </div>

        {/* Clear Accuracy Badge */}
        <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-300 font-mono">
          Clear Recognition Rate: <span className="text-[var(--color-gold)] font-bold">{clearPercent}%</span>
        </div>

        {/* CTAs */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={onBackToSetup}
            className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-neutral-300 hover:text-white transition"
          >
            Change Category
          </button>
          <button
            onClick={onRestart}
            className="btn-crimson font-audiowide text-xs tracking-wider uppercase px-6 py-2.5 rounded-xl shadow-lg"
          >
            Practice Again
          </button>
        </div>
      </div>
    </div>
  );
}
