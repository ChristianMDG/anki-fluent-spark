import { useEffect, useRef, useState } from "react";
import { X, RefreshCw, Volume2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { generateFullLesson, type FullLesson } from "@/lib/vocab.functions";
import { toast } from "sonner";

interface Props {
  cardId: string;
  word: string;
  ipa: string;
  level: string;
  onClose: () => void;
}

const SECTIONS = [
  { id: "explanation", label: "Explanation" },
  { id: "pronunciation", label: "Pronunciation" },
  { id: "register", label: "Context" },
  { id: "syn", label: "Synonyms" },
  { id: "idioms", label: "Idioms" },
  { id: "mistakes", label: "Mistakes" },
  { id: "collocations", label: "Collocations" },
  { id: "reading", label: "Reading" },
  { id: "dialogue", label: "Dialogue" },
  { id: "speak", label: "Speak" },
  { id: "quiz", label: "Quiz" },
] as const;

export function FullLessonModal({ cardId, word, ipa, level, onClose }: Props) {
  const genFn = useServerFn(generateFullLesson);
  const qc = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<string>("explanation");

  const query = useQuery({
    queryKey: ["lesson", cardId],
    queryFn: () => genFn({ data: { cardId } }) as Promise<FullLesson>,
    staleTime: Infinity,
  });

  useEffect(() => {
    const c = containerRef.current;
    if (!c || !query.data) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveSection(e.target.id);
        }
      },
      { root: c, rootMargin: "-40% 0px -55% 0px", threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = c.querySelector(`#${s.id}`);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [query.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function regenerate() {
    try {
      const fresh = await genFn({ data: { cardId, force: true } });
      qc.setQueryData(["lesson", cardId], fresh);
      toast.success("Leçon régénérée");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  const scrollTo = (id: string) => {
    containerRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const lesson = query.data;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex md:items-center md:p-6">
      <div className="glass-panel w-full h-full md:h-[92vh] md:max-w-3xl md:mx-auto flex flex-col overflow-hidden">
        <header className="sticky top-0 z-10 flex items-center justify-between p-4 md:p-5 border-b border-[color:var(--color-border)] bg-black/40 backdrop-blur">
          <div>
            <h2 className="text-xl md:text-2xl font-bold">{word}</h2>
            <div className="text-xs text-muted-foreground mt-0.5 flex gap-2">
              {ipa && <span className="font-mono">{ipa}</span>}
              {level && <span className="label-mono text-[color:var(--color-gold)]">{level}</span>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg">
            <X size={20} />
          </button>
        </header>

        {lesson && (
          <div className="border-b border-[color:var(--color-border)] overflow-x-auto">
            <div className="flex gap-1 px-4 py-2 min-w-max">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  className={`text-xs px-2.5 py-1 rounded-md label-mono transition ${
                    activeSection === s.id
                      ? "bg-[color:var(--color-crimson)]/40 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={containerRef} className="flex-1 overflow-y-auto">
          <div className="max-w-[640px] mx-auto px-5 md:px-8 py-6 space-y-8">
            {query.isLoading && <LoadingLesson />}
            {query.isError && (
              <div className="text-center py-12">
                <p className="text-destructive-foreground">Erreur : {(query.error as Error).message}</p>
                <button onClick={() => query.refetch()} className="btn-crimson mt-4 rounded-lg px-4 py-2">
                  Réessayer
                </button>
              </div>
            )}
            {lesson && (
              <>
                <Section id="explanation" title="Explanation">
                  <p className="leading-relaxed">{lesson.explanation}</p>
                </Section>

                <Section id="pronunciation" title="Pronunciation">
                  <p className="leading-relaxed">{lesson.pronunciationTips}</p>
                </Section>

                <Section id="register" title="Depending on context">
                  <div className="space-y-2">
                    {lesson.registerVariants?.map((v, i) => (
                      <div
                        key={i}
                        className={`p-3 rounded-lg border-l-4 ${
                          v.register === "formal"
                            ? "border-blue-400 bg-blue-950/20"
                            : v.register === "casual"
                              ? "border-emerald-400 bg-emerald-950/20"
                              : "border-amber-400 bg-amber-950/20"
                        }`}
                      >
                        <p className="label-mono mb-1">{v.register}</p>
                        <p>{v.example}</p>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section id="syn" title="Synonyms & Antonyms">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="label-mono mb-2">Synonyms</p>
                      <ul className="space-y-1.5 text-sm">
                        {lesson.synonyms?.map((s, i) => (
                          <li key={i}>
                            <span className="font-semibold text-[color:var(--color-gold)]">{s.word}</span>
                            <span className="text-muted-foreground"> — {s.nuance}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="label-mono mb-2">Antonyms</p>
                      <ul className="space-y-1.5 text-sm">
                        {lesson.antonyms?.map((s, i) => (
                          <li key={i}>
                            <span className="font-semibold text-[color:var(--color-gold)]">{s.word}</span>
                            <span className="text-muted-foreground"> — {s.nuance}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Section>

                <Section id="idioms" title="Related idioms">
                  <ul className="space-y-2">
                    {lesson.relatedIdioms?.map((it, i) => (
                      <li key={i}>
                        <p className="font-semibold">{it.phrase}</p>
                        <p className="text-sm text-muted-foreground">{it.meaning}</p>
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section id="mistakes" title="Common mistakes">
                  <ul className="list-disc pl-5 space-y-1.5 text-sm">
                    {lesson.commonMistakes?.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </Section>

                <Section id="collocations" title="Collocations">
                  <div className="flex flex-wrap gap-2">
                    {lesson.collocations?.map((c, i) => (
                      <span key={i} className="px-3 py-1 rounded-full bg-white/5 text-sm">
                        {c}
                      </span>
                    ))}
                  </div>
                </Section>

                <Section id="reading" title="Reading">
                  <button
                    onClick={() => speak(lesson.readingPassage)}
                    className="text-xs flex items-center gap-1 mb-2 text-muted-foreground hover:text-foreground"
                  >
                    <Volume2 size={14} /> Listen
                  </button>
                  <p className="leading-relaxed">{highlightWord(lesson.readingPassage, word)}</p>
                </Section>

                <Section id="dialogue" title={lesson.dialogue?.title || "Dialogue"}>
                  <button
                    onClick={() =>
                      speak(lesson.dialogue.lines.map((l) => `${l.speaker}: ${l.text}`).join(". "))
                    }
                    className="text-xs flex items-center gap-1 mb-3 text-muted-foreground hover:text-foreground"
                  >
                    <Volume2 size={14} /> Listen to dialogue
                  </button>
                  <div className="space-y-2">
                    {lesson.dialogue?.lines.map((l, i) => (
                      <div
                        key={i}
                        className={`flex ${l.speaker === "A" ? "justify-start" : "justify-end"}`}
                      >
                        <div
                          className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                            l.speaker === "A"
                              ? "bg-white/5 rounded-bl-none"
                              : "bg-[color:var(--color-crimson)]/30 rounded-br-none"
                          }`}
                        >
                          <p className="label-mono mb-0.5">{l.speaker}</p>
                          {l.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section id="speak" title="Speak it out" tone="orange">
                  <ul className="space-y-3">
                    {lesson.speakingPrompts?.map((p, i) => (
                      <li key={i} className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30">
                        {p}
                      </li>
                    ))}
                  </ul>
                </Section>

                <Section id="quiz" title="Quiz" tone="red">
                  <Quiz quiz={lesson.quiz} />
                </Section>

                <div className="pt-4 border-t border-[color:var(--color-border)]">
                  <button
                    onClick={regenerate}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCw size={14} /> Regenerate lesson
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  tone,
  children,
}: {
  id: string;
  title: string;
  tone?: "orange" | "red";
  children: React.ReactNode;
}) {
  const bg =
    tone === "orange"
      ? "bg-amber-950/10 border-amber-500/20"
      : tone === "red"
        ? "bg-red-950/15 border-red-500/25"
        : "";
  return (
    <section id={id} className={`scroll-mt-4 ${bg ? `p-5 rounded-xl border ${bg}` : ""}`}>
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Quiz({ quiz }: { quiz: FullLesson["quiz"] }) {
  return (
    <div className="space-y-5">
      {quiz?.map((q, i) => (
        <QuizItem key={i} q={q} />
      ))}
    </div>
  );
}

function QuizItem({ q }: { q: FullLesson["quiz"][number] }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div>
      <p className="font-medium mb-2">{q.question}</p>
      <div className="space-y-1.5">
        {q.options.map((opt, i) => {
          const isCorrect = i === q.correctIndex;
          const revealed = picked !== null;
          return (
            <button
              key={i}
              disabled={revealed}
              onClick={() => setPicked(i)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition ${
                revealed
                  ? isCorrect
                    ? "border-emerald-500 bg-emerald-950/30 text-emerald-200"
                    : picked === i
                      ? "border-red-500 bg-red-950/30 text-red-200"
                      : "border-[color:var(--color-border)] opacity-60"
                  : "border-[color:var(--color-border)] hover:border-[color:var(--color-crimson-glow)]"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <p className="text-sm text-muted-foreground mt-2">{q.explanation}</p>
      )}
    </div>
  );
}

function highlightWord(text: string, word: string) {
  if (!word) return text;
  const parts = text.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) =>
    p.toLowerCase() === word.toLowerCase() ? (
      <span key={i} className="word-target">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function LoadingLesson() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 bg-white/5 rounded w-1/3" />
      <div className="h-3 bg-white/5 rounded" />
      <div className="h-3 bg-white/5 rounded w-4/5" />
      <div className="h-3 bg-white/5 rounded w-3/5" />
      <p className="text-center text-muted-foreground text-sm pt-8">Génération de la leçon…</p>
    </div>
  );
}
