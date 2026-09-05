import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateVocabCard } from "@/lib/vocab.functions";
import { VocabCard, type CardRow } from "@/components/VocabCard";
import { toast } from "sonner";
import {
  Sparkles,
  Trash2,
  Search,
  X,
  Loader2,
  ArrowDownAZ,
  Clock,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  AlertTriangle,
  Download,
} from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import { downloadTsv } from "@/lib/tsv-export";
import { z } from "zod";

const generateSearch = z.object({
  review: z.enum(["1"]).optional(),
});

export const Route = createFileRoute("/_authenticated/library")({
  component: GeneratePage,
  validateSearch: (s) => generateSearch.parse(s),
});

const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2", "Other"];
type SortMode = "recent" | "alpha";

function GeneratePage() {
  const genFn = useServerFn(generateVocabCard);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const reviewOnly = search.review === "1";
  const inputRef = useRef<HTMLInputElement>(null);
  const [word, setWord] = useState("");
  const [currentCard, setCurrentCard] = useState<CardRow | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "queued" | "exported">("all");
  const [sort, setSort] = useState<SortMode>("recent");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

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
    mutationFn: async () => (await genFn({ data: { word: word.trim() } })) as CardRow,
    onSuccess: (card) => {
      setCurrentCard(card);
      setWord("");
      qc.invalidateQueries({ queryKey: ["cards"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["daily_count"] });
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

  function toggleReview() {
    navigate({
      to: "/library",
      search: { review: reviewOnly ? undefined : "1" },
    });
  }

  const queuedCount = (history.data ?? []).filter((c) => !c.exported).length;
  const reviewCount = (history.data ?? []).filter((c) => c.needs_review).length;
  const exportedCount = (history.data ?? []).filter((c) => c.exported).length;

  const filtered = useMemo(() => {
    const list = history.data ?? [];
    const needle = q.trim().toLowerCase();
    const result = list.filter((c) => {
      if (filter === "queued" && c.exported) return false;
      if (filter === "exported" && !c.exported) return false;
      if (reviewOnly && !c.needs_review) return false;
      if (!needle) return true;
      return (
        c.word.toLowerCase().includes(needle) ||
        (c.definition ?? "").toLowerCase().includes(needle) ||
        (c.french ?? "").toLowerCase().includes(needle)
      );
    });
    if (sort === "alpha") {
      return [...result].sort((a, b) => a.word.localeCompare(b.word));
    }
    return result;
  }, [history.data, q, filter, sort, reviewOnly]);

  function exportFiltered() {
    if (filtered.length === 0) return toast.info("No cards to export");
    downloadTsv(
      filtered.map((c) => ({
        word: c.word,
        ipa: c.ipa ?? "",
        pos: c.pos ?? "",
        level: c.level ?? "",
        definition: c.definition ?? "",
        french: c.french ?? "",
        grammar: c.grammar ?? "",
        examples: c.examples ?? "",
        cloze: c.cloze ?? "",
        speaking_q1: "",
        speaking_a1: "",
        speaking_q2: "",
        speaking_a2: "",
      })),
    );
    toast.success(`${filtered.length} card(s) exported`);
  }

  // Group by level so the library reads as folders of dossiers instead of one long scroll.
  // While actively searching, skip grouping — a flat list is faster to scan for a specific hit.
  const isSearching = q.trim().length > 0;
  const groups = useMemo(() => {
    // Skip grouping when searching or in review mode — flat list is clearer
    if (isSearching || reviewOnly) return null;
    const byLevel = new Map<string, CardRow[]>();
    for (const c of filtered) {
      const key = c.level && LEVEL_ORDER.includes(c.level) ? c.level : "Other";
      if (!byLevel.has(key)) byLevel.set(key, []);
      byLevel.get(key)!.push(c);
    }
    return LEVEL_ORDER.map((key) => ({ key, cards: byLevel.get(key) ?? [] })).filter(
      (g) => g.cards.length > 0
    );
  }, [filtered, isSearching, reviewOnly]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allGroupKeys = groups?.map((g) => g.key) ?? [];
  const allOpen = allGroupKeys.length > 0 && allGroupKeys.every((k) => openGroups.has(k));

  function toggleAllGroups() {
    setOpenGroups(allOpen ? new Set() : new Set(allGroupKeys));
  }



  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
        <section className="w-full [container-type:inline-size]">
          <div className="flex items-baseline justify-between mb-3">
            <p className="label-mono text-[color:var(--color-gold)]">Your card</p>
            <button
              onClick={() => setCurrentCard(null)}
              className="text-xs text-muted-foreground hover:text-foreground transition flex items-center gap-1"
            >
              <X size={12} /> Dismiss
            </button>
          </div>
          <div className="w-full min-w-0">
            <VocabCard
              card={currentCard}
              layout="sidebar"
              onDelete={() => deleteCard(currentCard.id)}
            />
          </div>
        </section>
      )}

      {/* Library */}
      <section>
        <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
          <div>
            <p className="label-mono text-[color:var(--color-gold)]">Library</p>
            <h2 className="text-xl font-bold mt-1">
              {filtered.length} / {history.data?.length ?? 0} cards
              {queuedCount > 0 && (
                <span className="ml-2 text-sm font-normal text-[color:var(--color-gold)]">
                  · {queuedCount} queued
                </span>
              )}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportFiltered}
              className="btn-crimson rounded-lg px-4 py-2 text-sm flex items-center gap-2"
            >
              <Download size={14} /> Export selection
            </button>
            {(history.data?.length ?? 0) > 0 && (
              <button
                onClick={clearAllCards}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-400 transition px-3 py-2 rounded-md hover:bg-red-500/5"
              >
                <Trash2 size={12} /> Clear all
              </button>
            )}
          </div>
        </div>

        {(history.data?.length ?? 0) > 0 && (
          <div className="sticky top-0 z-10 -mx-1 px-1 py-2 mb-4 bg-[color:var(--background)]/80 backdrop-blur-md space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search word, definition, French…"
                  className="w-full glass-panel-soft pl-9 pr-8 py-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[color:var(--color-crimson-glow)]"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="flex gap-1 glass-panel-soft p-1 rounded-lg">
                {(
                  [
                    ["all", "All", history.data?.length ?? 0],
                    ["queued", "Queued", queuedCount],
                    ["exported", "Exported", exportedCount],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`px-3 py-1.5 rounded-md text-xs label-mono transition flex items-center gap-1.5 ${
                      filter === key
                        ? "bg-[color:var(--color-crimson)]/40 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                    <span className="text-[10px] opacity-60">{count}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={toggleReview}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition ${
                  reviewOnly
                    ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                    : "border-[color:var(--color-border)] text-muted-foreground hover:text-foreground hover:border-amber-500/30 hover:text-amber-300"
                }`}
              >
                <AlertTriangle size={13} /> Needs review
                {reviewCount > 0 && (
                  <span className={`ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                    reviewOnly ? "bg-amber-500/30 text-amber-200" : "bg-amber-500/15 text-amber-400"
                  }`}>
                    {reviewCount}
                  </span>
                )}
              </button>

              <div className="flex gap-1 glass-panel-soft p-1 rounded-lg">
                <button
                  onClick={() => setSort("recent")}
                  title="Sort by most recent"
                  className={`p-1.5 rounded-md transition ${
                    sort === "recent"
                      ? "bg-[color:var(--color-crimson)]/40 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Clock size={14} />
                </button>
                <button
                  onClick={() => setSort("alpha")}
                  title="Sort alphabetically"
                  className={`p-1.5 rounded-md transition ${
                    sort === "alpha"
                      ? "bg-[color:var(--color-crimson)]/40 text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ArrowDownAZ size={14} />
                </button>
              </div>

              {groups && groups.length > 1 && (
                <button
                  onClick={toggleAllGroups}
                  className="flex items-center gap-1.5 label-mono text-[10px] tracking-wider text-muted-foreground hover:text-foreground glass-panel-soft px-3 py-2 rounded-lg transition"
                >
                  {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
                  {allOpen ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>

            {(q || filter !== "all" || reviewOnly) && (
              <p className="text-[11px] text-muted-foreground pl-1">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}

        {history.isLoading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            <CardSkeleton compact />
            <CardSkeleton compact />
            <CardSkeleton compact />
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-panel-soft p-10 text-center space-y-2">
            {reviewOnly ? (
              <>
                <p className="text-2xl">✅</p>
                <p className="text-sm font-medium text-white">All caught up!</p>
                <p className="text-xs text-muted-foreground">
                  No cards flagged for review. Use the{" "}
                  <span className="text-amber-400">🏳 flag</span> on any card to add it here.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {(history.data?.length ?? 0) === 0
                  ? "No cards yet — generate your first one above."
                  : "No cards match this filter."}
              </p>
            )}
          </div>
        ) : isSearching || !groups ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-fr">
            {filtered.map((c) => (
              <VocabCard key={c.id} card={c} compact onDelete={() => deleteCard(c.id)} />
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            {groups.map(({ key, cards }) => {
              const isOpen = openGroups.has(key);
              return (
                <div key={key} className="glass-panel-soft rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggleGroup(key)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition"
                  >
                    <ChevronRight
                      size={14}
                      className={`text-muted-foreground shrink-0 transition-transform ${
                        isOpen ? "rotate-90" : ""
                      }`}
                    />
                    <span
                      className="w-8 h-8 shrink-0 flex items-center justify-center bg-gradient-to-br from-[color:var(--color-gold)]/25 to-[color:var(--color-gold)]/5 border border-[color:var(--color-gold)]/50 text-[color:var(--color-gold)] label-mono text-[10px] font-bold"
                      style={{
                        clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
                      }}
                    >
                      {key === "Other" ? "?" : key}
                    </span>
                    <span className="font-semibold text-sm text-left">
                      {key === "Other" ? "No level" : `Level ${key}`}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto label-mono">
                      {cards.length} card{cards.length !== 1 ? "s" : ""}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 grid md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-fr animate-in fade-in slide-in-from-top-1 duration-200">
                      {cards.map((c) => (
                        <VocabCard key={c.id} card={c} compact onDelete={() => deleteCard(c.id)} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function CardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`glass-panel p-6 space-y-4 animate-pulse relative overflow-hidden ${
        compact ? "h-[180px]" : ""
      }`}
    >
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-[color:var(--color-crimson)]/10 rounded-full blur-2xl pointer-events-none" />
      <div className="flex items-center gap-3 relative">
        <div className="h-7 w-40 bg-white/5 rounded" />
        <div className="h-5 w-10 bg-white/5 rounded" />
      </div>
      <div className="h-3 w-24 bg-white/5 rounded relative" />
      <div className="space-y-2 relative">
        <div className="h-3 bg-white/5 rounded w-full" />
        <div className="h-3 bg-white/5 rounded w-5/6" />
        {!compact && <div className="h-3 bg-white/5 rounded w-4/6" />}
      </div>
      {!compact && (
        <p className="text-xs text-muted-foreground pt-2 flex items-center gap-2 relative">
          <Loader2 size={12} className="animate-spin" /> Generating your card…
        </p>
      )}
    </div>
  );
}