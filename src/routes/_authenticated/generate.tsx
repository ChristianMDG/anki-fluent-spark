import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateVocabCard } from "@/lib/vocab.functions";
import { VocabCard, type CardRow } from "@/components/VocabCard";
import { toast } from "sonner";
import { Sparkles, Trash2, Search, X, Loader2 } from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/_authenticated/generate")({
  component: GeneratePage,
});

const LEVELS = ["", "A1", "A2", "B1", "B2", "C1", "C2"];

function GeneratePage() {
  const genFn = useServerFn(generateVocabCard);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [word, setWord] = useState("");
  const [level, setLevel] = useState("");
  const [currentCard, setCurrentCard] = useState<CardRow | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "queued" | "exported">("all");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const history = useQuery({
    queryKey: ["cards", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as CardRow[];
    },
  });

  const gen = useMutation({
    mutationFn: async () =>
      (await genFn({ data: { word: word.trim(), level: level || undefined } })) as CardRow,
    onSuccess: (card) => {
      setCurrentCard(card);
      setWord("");
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.success(`Card for "${card.word}" ready`);
      inputRef.current?.focus();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  async function deleteCard(id: string) {
    const card = (history.data ?? []).find((c) => c.id === id) ?? currentCard;
    const ok = await confirmDialog({
      title: "Delete this card?",
      description: card
        ? `"${card.word}" and its full lesson will be permanently removed.`
        : "This card and its lesson will be permanently removed.",
      confirmLabel: "Delete card",
    });
    if (!ok) return;
    const { error } = await supabase.from("cards").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (currentCard?.id === id) setCurrentCard(null);
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Card deleted");
  }

  async function clearAllCards() {
    const ok = await confirmDialog({
      title: "Delete all your cards?",
      description: `${history.data?.length ?? 0} cards and their lessons will be permanently deleted. This cannot be undone.`,
      confirmLabel: "Delete everything",
    });
    if (!ok) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const { error } = await supabase.from("cards").delete().eq("user_id", user.id);
    if (error) return toast.error(error.message);
    setCurrentCard(null);
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("All cards deleted");
  }

  const filtered = useMemo(() => {
    const list = history.data ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((c) => {
      if (filter === "queued" && c.exported) return false;
      if (filter === "exported" && !c.exported) return false;
      if (!q) return true;
      return (
        c.word.toLowerCase().includes(q) ||
        (c.definition ?? "").toLowerCase().includes(q) ||
        (c.french ?? "").toLowerCase().includes(q)
      );
    });
  }, [history.data, search, filter]);

  const queuedCount = (history.data ?? []).filter((c) => !c.exported).length;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Composer */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <p className="label-mono text-[color:var(--color-gold)]">Step 1</p>
            <h1 className="text-3xl font-bold mt-1">Pick your word</h1>
          </div>
          <p className="text-xs text-muted-foreground hidden md:block">
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-[color:var(--color-border)] font-mono">
              Enter
            </kbd>{" "}
            to generate
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!word.trim() || gen.isPending) return;
            gen.mutate();
          }}
          className="glass-panel p-4 md:p-5"
        >
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="An English word or expression…"
                className="w-full glass-panel-soft pl-4 pr-10 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-crimson-glow)] transition"
                required
                autoComplete="off"
              />
              {word && !gen.isPending && (
                <button
                  type="button"
                  onClick={() => setWord("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="glass-panel-soft px-4 py-3 rounded-lg focus:outline-none cursor-pointer"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l} className="bg-black">
                  {l || "Level ?"}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!word.trim() || gen.isPending}
              className="btn-crimson rounded-lg px-6 py-3 font-medium flex items-center justify-center gap-2 min-w-[140px]"
            >
              {gen.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles size={16} /> Generate
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Current card / loading skeleton */}
      {gen.isPending && !currentCard && <CardSkeleton />}

      {currentCard && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <p className="label-mono text-[color:var(--color-gold)]">Your card</p>
            <button
              onClick={() => setCurrentCard(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition flex items-center gap-1"
            >
              <X size={12} /> Dismiss
            </button>
          </div>
          <VocabCard card={currentCard} onDelete={() => deleteCard(currentCard.id)} />
        </section>
      )}

      {/* Library */}
      <section>
        <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="label-mono text-[color:var(--color-gold)]">Library</p>
            <h2 className="text-xl font-bold mt-1">
              {history.data?.length ?? 0} cards
              {queuedCount > 0 && (
                <span className="ml-2 text-sm font-normal text-[color:var(--color-gold)]">
                  · {queuedCount} queued
                </span>
              )}
            </h2>
          </div>
          {(history.data?.length ?? 0) > 0 && (
            <button
              onClick={clearAllCards}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-400 transition px-3 py-2 rounded-md hover:bg-red-500/5"
            >
              <Trash2 size={12} /> Clear all
            </button>
          )}
        </div>

        {(history.data?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search word, definition, French…"
                className="w-full glass-panel-soft pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[color:var(--color-crimson-glow)]"
              />
            </div>
            <div className="flex gap-1 glass-panel-soft p-1 rounded-lg">
              {(["all", "queued", "exported"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-xs label-mono transition ${
                    filter === f
                      ? "bg-[color:var(--color-crimson)]/40 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="glass-panel-soft p-10 text-center">
            <p className="text-sm text-muted-foreground">
              {(history.data?.length ?? 0) === 0
                ? "No cards yet — generate your first one above."
                : "No cards match this filter."}
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((c) => (
              <VocabCard key={c.id} card={c} compact onDelete={() => deleteCard(c.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="glass-panel p-6 space-y-4 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-7 w-40 bg-white/5 rounded" />
        <div className="h-5 w-10 bg-white/5 rounded" />
      </div>
      <div className="h-3 w-24 bg-white/5 rounded" />
      <div className="space-y-2">
        <div className="h-3 bg-white/5 rounded w-full" />
        <div className="h-3 bg-white/5 rounded w-5/6" />
        <div className="h-3 bg-white/5 rounded w-4/6" />
      </div>
      <p className="text-xs text-muted-foreground pt-2 flex items-center gap-2">
        <Loader2 size={12} className="animate-spin" /> Generating your card…
      </p>
    </div>
  );
}
