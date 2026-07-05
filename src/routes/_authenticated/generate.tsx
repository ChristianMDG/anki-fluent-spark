import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { generateVocabCard } from "@/lib/vocab.functions";
import { VocabCard, type CardRow } from "@/components/VocabCard";
import { toast } from "sonner";
import { ChevronDown, Sparkles, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/generate")({
  component: GeneratePage,
});

const LEVELS = ["", "A1", "A2", "B1", "B2", "C1", "C2"];

function GeneratePage() {
  const genFn = useServerFn(generateVocabCard);
  const qc = useQueryClient();
  const [word, setWord] = useState("");
  const [level, setLevel] = useState("");
  const [currentCard, setCurrentCard] = useState<CardRow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const history = useQuery({
    queryKey: ["cards", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
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
      toast.success(`Card for "${card.word}" created`);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  async function deleteCard(id: string) {
    if (!confirm("Delete this card and its lesson?")) return;
    const { error } = await supabase.from("cards").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (currentCard?.id === id) setCurrentCard(null);
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Card deleted");
  }

  async function clearAllCards() {
    if (!confirm("Delete ALL your cards? This cannot be undone.")) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const { error } = await supabase.from("cards").delete().eq("user_id", user.id);
    if (error) return toast.error(error.message);
    setCurrentCard(null);
    qc.invalidateQueries({ queryKey: ["cards"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("All cards deleted");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <p className="label-mono text-[color:var(--color-gold)]">Step 1</p>
        <h1 className="text-3xl font-bold mt-1">Pick your word</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!word.trim() || gen.isPending) return;
          gen.mutate();
        }}
        className="glass-panel p-5 space-y-3"
      >
        <div className="flex flex-col md:flex-row gap-3">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="An English word or expression…"
            className="flex-1 glass-panel-soft px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-[color:var(--color-crimson-glow)]"
            required
          />
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="glass-panel-soft px-4 py-3 rounded-lg focus:outline-none"
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
            className="btn-crimson rounded-lg px-6 py-3 font-medium flex items-center gap-2"
          >
            <Sparkles size={16} />
            {gen.isPending ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>

      {currentCard && (
        <div>
          <p className="label-mono text-[color:var(--color-gold)] mb-3">Your card</p>
          <VocabCard card={currentCard} onDelete={() => deleteCard(currentCard.id)} />
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-2 label-mono hover:text-foreground transition"
          >
            <ChevronDown
              size={14}
              className={`transition ${historyOpen ? "rotate-0" : "-rotate-90"}`}
            />
            Previous cards ({history.data?.length ?? 0})
          </button>
          {historyOpen && (history.data?.length ?? 0) > 0 && (
            <button
              onClick={clearAllCards}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition"
            >
              <Trash2 size={12} /> Clear all
            </button>
          )}
        </div>
        {historyOpen && history.data && (
          <div className="mt-4 space-y-3">
            {history.data.map((c) => (
              <VocabCard key={c.id} card={c} compact onDelete={() => deleteCard(c.id)} />
            ))}
            {history.data.length === 0 && (
              <p className="text-sm text-muted-foreground">No cards yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
