import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { VocabCard, type CardRow } from "@/components/VocabCard";
import { toast } from "sonner";
import { AlertTriangle, Download, Search, Trash2 } from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import { downloadTsv } from "@/lib/tsv-export";
import { z } from "zod";

const librarySearch = z.object({
  review: z.enum(["1"]).optional(),
});

export const Route = createFileRoute("/_authenticated/library")({
  component: LibraryPage,
  validateSearch: (s) => librarySearch.parse(s),
});

function LibraryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: "/library" });
  const search = Route.useSearch();
  const reviewOnly = search.review === "1";
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const cards = useQuery({
    queryKey: ["cards", "library"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as CardRow[];
    },
  });

  const allTags = useMemo(() => {
    const set = new Set<string>();
    (cards.data ?? []).forEach((c) => (c.tags ?? []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [cards.data]);

  const filtered = useMemo(() => {
    const list = cards.data ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((c) => {
      if (reviewOnly && !c.needs_review) return false;
      if (
        selectedTags.length > 0 &&
        !selectedTags.some((t) => (c.tags ?? []).includes(t))
      )
        return false;
      if (!needle) return true;
      return (
        c.word.toLowerCase().includes(needle) ||
        (c.definition ?? "").toLowerCase().includes(needle) ||
        (c.french ?? "").toLowerCase().includes(needle)
      );
    });
  }, [cards.data, selectedTags, q, reviewOnly]);

  function toggleTag(t: string) {
    setSelectedTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function toggleReview() {
    navigate({ search: (prev: { review?: "1" }) => ({ ...prev, review: reviewOnly ? undefined : "1" }) });
  }

  async function deleteCard(id: string) {
    const card = filtered.find((c) => c.id === id);
    const ok = await confirmDialog({
      title: "Delete this card?",
      description: card ? `"${card.word}" and its full lesson will be permanently removed.` : "",
      confirmLabel: "Delete card",
    });
    if (!ok) return;
    const { error } = await supabase.from("cards").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Card deleted");
  }

  function exportFiltered() {
    if (filtered.length === 0) return toast.info("Aucune fiche à exporter");
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
    toast.success(`${filtered.length} fiche(s) exportée(s)`);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Mes fiches</p>
          <h1 className="text-3xl md:text-4xl font-bold mt-1">
            Ta bibliothèque
            <span className="text-base font-normal text-muted-foreground ml-2">
              · {filtered.length} / {cards.data?.length ?? 0}
            </span>
          </h1>
        </div>
        <button
          onClick={exportFiltered}
          className="btn-crimson rounded-lg px-4 py-2 text-sm flex items-center gap-2"
        >
          <Download size={14} /> Exporter la sélection
        </button>
      </div>

      <div className="glass-panel-soft p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="w-full glass-panel-soft pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[color:var(--color-crimson-glow)]"
            />
          </div>
          <button
            onClick={toggleReview}
            className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition ${
              reviewOnly
                ? "border-amber-500/60 bg-amber-500/15 text-amber-300"
                : "border-[color:var(--color-border)] text-muted-foreground hover:text-foreground"
            }`}
          >
            <AlertTriangle size={13} /> À revoir uniquement
          </button>
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Réinitialiser tags
            </button>
          )}
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="label-mono text-xs pr-1 pt-1">Tags (OU)</span>
            {allTags.map((t) => {
              const active = selectedTags.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition ${
                    active
                      ? "bg-[color:var(--color-crimson)]/40 border-[color:var(--color-crimson-glow)] text-foreground"
                      : "bg-[color:var(--color-crimson)]/10 border-[color:var(--color-crimson)]/30 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {cards.isLoading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="glass-panel-soft p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {(cards.data?.length ?? 0) === 0
              ? "Aucune fiche pour le moment."
              : "Aucune fiche ne correspond à ces filtres."}
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map((c) => (
            <VocabCard key={c.id} card={c} compact onDelete={() => deleteCard(c.id)} />
          ))}
        </div>
      )}
      {/* silence unused import */}
      <span className="hidden">
        <Trash2 />
      </span>
    </div>
  );
}
