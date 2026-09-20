import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { PronunciationChallenge } from "@/lib/pronunciation-challenges";
import { getSpeechRecognitionCtor, type SpeechRecognitionLike } from "@/lib/speech";
import { PitchContourChart } from "@/components/fluency/PitchContourChart";
import { analyzePronunciationChallenge, generateVocabCard } from "@/lib/vocab.functions";
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
  Sparkles,
  Info,
  ChevronLeft,
  Activity,
  Loader2,
  Clock,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Route Definition
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/_authenticated/pronunciation")({
  component: PronunciationPage,
});

// ---------------------------------------------------------------------------
// DB Types & Hooks
// ---------------------------------------------------------------------------

interface CustomPronunciationItem {
  id: string;
  word_or_phrase: string;
  ipa: string;
  challenge_category: string;
  confusable_alternative: string | null;
  articulation_tip: string;
  stress_note: string | null;
  created_at: string;
}

function useRecentCustomItems() {
  return useQuery({
    queryKey: ["custom-pronunciation-items"],
    queryFn: async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return [] as CustomPronunciationItem[];

        const { data, error } = await supabase
          .from("custom_pronunciation_items")
          .select(
            "id, word_or_phrase, ipa, challenge_category, confusable_alternative, articulation_tip, stress_note, created_at",
          )
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error || !data) return [] as CustomPronunciationItem[];
        return data as CustomPronunciationItem[];
      } catch {
        return [] as CustomPronunciationItem[];
      }
    },
    staleTime: 5_000,
  });
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

type ViewMode = "setup" | "session";

function PronunciationPage() {
  const [view, setView] = useState<ViewMode>("setup");
  const [activeChallenges, setActiveChallenges] = useState<PronunciationChallenge[]>([]);

  function handleStartCustomSession(challenge: PronunciationChallenge) {
    setActiveChallenges([challenge]);
    setView("session");
  }

  function handleReturnToSetup() {
    setView("setup");
  }

  function handleFinishSession() {
    // Single-word custom sessions always return straight to the word input.
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

  return <CustomWordSetup onStartCustom={handleStartCustomSession} />;
}

// ===========================================================================
// WORD INPUT + RECENTLY PRACTICED (Landing view)
// ===========================================================================

interface CustomWordSetupProps {
  onStartCustom: (challenge: PronunciationChallenge) => void;
}

function CustomWordSetup({ onStartCustom }: CustomWordSetupProps) {
  const analyzeFn = useServerFn(analyzePronunciationChallenge);
  const qc = useQueryClient();
  const [wordInput, setWordInput] = useState("");
  const { data: recentItems = [], isLoading: recentLoading } = useRecentCustomItems();

  const analysisMutation = useMutation({
    mutationFn: async (wordOrPhrase: string) => await analyzeFn({ data: { wordOrPhrase } }),
    onSuccess: (analysis, wordOrPhrase) => {
      qc.invalidateQueries({ queryKey: ["custom-pronunciation-items"] });
      const challenge: PronunciationChallenge = {
        id: `custom-${Date.now()}`,
        category: analysis.challengeCategory,
        categoryLabel: formatCategoryLabel(analysis.challengeCategory),
        targetWord: wordOrPhrase.trim(),
        ipa: analysis.ipa,
        confusablePair: analysis.confusableAlternative ?? undefined,
        tip: analysis.articulationTip,
        stressNote: analysis.stressNote ?? undefined,
      };
      onStartCustom(challenge);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = wordInput.trim();
    if (!trimmed || analysisMutation.isPending) return;
    analysisMutation.mutate(trimmed);
  }

  function handleRecentSelect(item: CustomPronunciationItem) {
    const challenge: PronunciationChallenge = {
      id: `custom-${item.id}`,
      category: item.challenge_category,
      categoryLabel: formatCategoryLabel(item.challenge_category),
      targetWord: item.word_or_phrase,
      ipa: item.ipa,
      confusablePair: item.confusable_alternative ?? undefined,
      tip: item.articulation_tip,
      stressNote: item.stress_note ?? undefined,
    };
    onStartCustom(challenge);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10 animate-in fade-in duration-300">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 label-mono text-[var(--color-gold)]">
          <Sparkles size={16} /> PRONUNCIATION COACH
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Practice a Specific Word
        </h1>
        <p className="text-sm text-neutral-400 max-w-xl leading-relaxed">
          Type any English word or expression. The AI will identify its pronunciation challenges —
          IPA, articulation tip, confusable pair, and stress pattern — then you'll practice it
          with reference audio and real-time speech recognition feedback.
        </p>
      </div>

      {/* Honest Proxy Banner */}
      <div className="glass-panel p-4 border border-amber-500/30 rounded-2xl flex items-start gap-3 bg-amber-500/5 text-xs text-amber-200/90">
        <Info size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-amber-300">Honest Feedback Mechanism</p>
          <p className="leading-relaxed">
            Speech recognition is used as a practical proxy — it shows what the recognizer heard
            and detects slips toward a common confusable pair. Practice freely with unlimited
            retries on every word!
          </p>
        </div>
      </div>

      {/* Input Form */}
      <form
        id="form-custom-word"
        onSubmit={handleSubmit}
        className="glass-panel p-6 rounded-2xl border border-white/10 space-y-4"
      >
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              id="input-custom-word"
              value={wordInput}
              onChange={(e) => setWordInput(e.target.value)}
              placeholder={'e.g. "thoroughly", "particularly", "would you"…'}
              maxLength={100}
              disabled={analysisMutation.isPending}
              className="w-full glass-panel-soft pl-4 pr-10 py-3.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--color-crimson-glow)] transition text-white text-base placeholder:text-neutral-500 disabled:opacity-50"
              autoComplete="off"
              autoFocus
            />
            {wordInput && !analysisMutation.isPending && (
              <button
                type="button"
                onClick={() => setWordInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <button
            id="btn-analyse-word"
            type="submit"
            disabled={!wordInput.trim() || analysisMutation.isPending}
            className="btn-crimson rounded-xl px-7 py-3.5 font-semibold text-sm flex items-center justify-center gap-2 min-w-[180px] shrink-0 shadow-[0_4px_20px_rgba(237,28,36,0.3)] hover:shadow-[0_4px_30px_rgba(237,28,36,0.5)] transition-all"
          >
            {analysisMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Analysing…
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Analyse &amp; Practice
              </>
            )}
          </button>
        </div>

        {analysisMutation.isPending && (
          <div className="flex items-center gap-2.5 text-xs text-amber-300/80 animate-pulse">
            <Activity size={14} />
            <span>
              Identifying pronunciation challenges — IPA, confusable pair, stress pattern…
            </span>
          </div>
        )}
      </form>

      {/* Recently Practiced */}
      {(recentLoading || recentItems.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Clock size={15} className="text-[var(--color-gold)]" />
            Recently Practiced
          </div>

          {recentLoading ? (
            <div className="flex gap-2 flex-wrap">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-9 w-24 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {recentItems.map((item) => (
                <button
                  key={item.id}
                  id={`btn-recent-${item.id}`}
                  onClick={() => handleRecentSelect(item)}
                  className="group flex items-center gap-2 px-4 py-2 rounded-xl glass-panel-soft border border-white/10 hover:border-[var(--color-crimson)]/40 hover:bg-[var(--color-crimson)]/5 transition-all duration-200"
                  title={`${item.ipa} — ${formatCategoryLabel(item.challenge_category)}`}
                >
                  <span className="text-sm font-semibold text-white group-hover:text-[var(--color-gold)] transition-colors">
                    {item.word_or_phrase}
                  </span>
                  <span className="text-[10px] font-mono text-neutral-500">{item.ipa}</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-neutral-500">
            Click any word to practice again instantly — no AI call needed.
          </p>
        </div>
      )}
    </div>
  );
}

function formatCategoryLabel(cat: string): string {
  const map: Record<string, string> = {
    th_sounds: "TH Sounds (θ / ð)",
    vowels: "Long vs Short Vowels",
    english_r: "English R vs L",
    h_sounds: "Silent & Aspirated H",
    w_vs_v: "W vs V Distinction",
    word_stress: "Word Stress Placement",
    consonant_cluster: "Consonant Clusters",
    other: "Pronunciation Challenge",
  };
  return map[cat] ?? "Pronunciation Challenge";
}

// ===========================================================================
// SESSION DRILL VIEW
// ===========================================================================

interface SessionProps {
  challenges: PronunciationChallenge[];
  onComplete: () => void;
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

  // Vocabulary bridge state
  const [cardAlreadyExists, setCardAlreadyExists] = useState<boolean | null>(null);
  const [cardGenerated, setCardGenerated] = useState(false);
  const genCardFn = useServerFn(generateVocabCard);

  // Check whether a card already exists for this word
  useEffect(() => {
    setCardAlreadyExists(null);
    setCardGenerated(false);
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        const { data } = await supabase
          .from("cards")
          .select("id")
          .ilike("word", currentChallenge.targetWord)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!cancelled) setCardAlreadyExists(!!data);
      } catch {
        if (!cancelled) setCardAlreadyExists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentChallenge.targetWord]);

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
    } else if (confusable && (clean === confusable || clean.includes(confusable))) {
      setEvalResult("confusable");
      resultsRef.current.confusable++;
    } else {
      setEvalResult("inconclusive");
      resultsRef.current.inconclusive++;
    }
  }

  // Next / Done handler
  function handleNextWord() {
    if (currentIndex < challenges.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      resetWordState();
    } else {
      onComplete();
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

  // Vocabulary bridge
  const addToVocabMutation = useMutation({
    mutationFn: async () => await genCardFn({ data: { word: currentChallenge.targetWord } }),
    onSuccess: (card) => {
      setCardGenerated(true);
      setCardAlreadyExists(true);
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["daily_count"] });
      toast.success(`Full vocabulary card for "${card.word}" is ready in your Library!`);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Session Top Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white transition px-2.5 py-1.5 rounded-lg hover:bg-white/10"
        >
          <ChevronLeft size={16} /> <span>Back to input</span>
        </button>

        <span className="label-mono text-[10px] text-[var(--color-gold)] border border-[var(--color-gold)]/30 px-2 py-0.5 rounded-full">
          CUSTOM WORD
        </span>
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

        {/* Stress Note (shown when present) */}
        {currentChallenge.stressNote && (
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-200">
            <Activity size={14} className="text-purple-400 shrink-0" />
            <span className="leading-relaxed">{currentChallenge.stressNote}</span>
          </div>
        )}

        {/* Reference Audio */}
        <div className="flex justify-center">
          <button
            id="btn-hear-reference"
            onClick={playReferenceAudio}
            className="btn-crimson font-audiowide text-xs tracking-wider uppercase px-5 py-2.5 rounded-xl flex items-center gap-2 shadow-lg transition-all"
          >
            <Volume2 size={16} />
            <span>🔊 Hear it</span>
          </button>
        </div>

        {/* Articulation Tip */}
        <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-300 text-left flex items-start gap-2.5">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <span className="font-semibold text-amber-300">Articulation Tip:</span>{" "}
            {currentChallenge.tip}
          </p>
        </div>

        {/* Recording Controls */}
        <div className="pt-2 space-y-4">
          <div className="flex justify-center gap-3">
            {!isRecording ? (
              <button
                id="btn-say-it"
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

          {/* Feedback */}
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

              {evalResult === "confusable" && currentChallenge.confusablePair && (
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
                        Recognized:{" "}
                        <span className="font-mono text-amber-300">"{transcript}"</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Vocabulary bridge */}
              {cardAlreadyExists === false && !cardGenerated && (
                <div className="animate-in fade-in duration-200">
                  <button
                    id="btn-add-to-vocabulary"
                    onClick={() => addToVocabMutation.mutate()}
                    disabled={addToVocabMutation.isPending}
                    className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-300 hover:text-emerald-200 text-xs font-semibold transition-all duration-200 disabled:opacity-50"
                  >
                    {addToVocabMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        Generating full vocabulary card…
                      </>
                    ) : (
                      <>
                        <Plus size={14} />
                        + Also add to my vocabulary
                      </>
                    )}
                  </button>
                </div>
              )}

              {cardGenerated && (
                <div className="flex items-center gap-2 text-xs text-emerald-400/80 justify-center">
                  <CheckCircle2 size={13} />
                  <span>Added to your Library — full card ready!</span>
                </div>
              )}
            </div>
          )}

          {/* Fallback note if SpeechRecognition unsupported */}
          {!speechSupported && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-neutral-400 text-left">
              ℹ️ Speech recognition is unavailable in this browser. You can still record your
              take, listen back, and review the pitch chart below!
            </div>
          )}

          {/* Audio Take Playback */}
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

      {/* Pitch Contour Chart */}
      {audioBlob && (
        <div className="animate-in fade-in duration-300">
          <PitchContourChart blob={audioBlob} />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={resetWordState}
          className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 transition"
        >
          <RotateCcw size={14} />
          <span>🔁 Try Again</span>
        </button>

        <button
          id="btn-next-word"
          onClick={handleNextWord}
          className="btn-crimson font-audiowide text-xs tracking-wider uppercase px-6 py-2.5 rounded-xl flex items-center gap-2 shadow-lg"
        >
          <span>{currentIndex < challenges.length - 1 ? "Next Word →" : "Done ✓"}</span>
        </button>
      </div>
    </div>
  );
}
