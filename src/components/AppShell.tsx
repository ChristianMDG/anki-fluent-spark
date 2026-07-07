import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Home, Sparkles, Video, Download, LogOut, Library, Mic } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { downloadTsv } from "@/lib/tsv-export";
import { toast } from "sonner";

const NAV = [
  { to: "/home", label: "Home", icon: Home },
  { to: "/generate", label: "Generate", icon: Sparkles },
  { to: "/library", label: "Library", icon: Library },
  { to: "/fluency", label: "Fluency", icon: Mic },
  { to: "/shadowing", label: "Shadowing", icon: Video },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: pending = 0 } = useQuery({
    queryKey: ["cards", "pending-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("exported", false);
      return count ?? 0;
    },
    staleTime: 5000,
  });

  async function handleExport() {
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .eq("exported", false)
      .order("created_at", { ascending: true });
    if (error) return toast.error(error.message);
    if (!data || data.length === 0) return toast.info("No cards to export");
    downloadTsv(
      data.map((c) => ({
        word: c.word,
        ipa: c.ipa ?? "",
        pos: c.pos ?? "",
        level: c.level ?? "",
        definition: c.definition ?? "",
        french: c.french ?? "",
        grammar: c.grammar ?? "",
        examples: c.examples ?? "",
        cloze: c.cloze ?? "",
        speaking_q1: c.speaking_q1 ?? "",
        speaking_a1: c.speaking_a1 ?? "",
        speaking_q2: c.speaking_q2 ?? "",
        speaking_a2: c.speaking_a2 ?? "",
      })),
    );
    const ids = data.map((c) => c.id);
    await supabase.from("cards").update({ exported: true }).in("id", ids);
    qc.invalidateQueries({ queryKey: ["cards"] });
    toast.success(`${data.length} card(s) exported`);
  }

  async function handleSignOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="hidden md:flex md:flex-col md:w-56 md:min-h-screen md:sticky md:top-0 glass-panel-soft border-r border-[color:var(--color-border)] p-4 gap-1">
        <div className="mb-6 px-2">
          <p className="label-mono text-[color:var(--color-gold)]">Akatsuki</p>
          <p className="font-bold text-lg mt-0.5">Vocab to Anki</p>
        </div>
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = pathname === n.to || pathname.startsWith(n.to + "/");
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                active
                  ? "bg-[color:var(--color-crimson)]/25 text-foreground translate-x-0.5"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5 hover:translate-x-0.5"
              }`}
            >
              <Icon size={18} />
              {n.label}
            </Link>
          );
        })}
        <div className="mt-auto pt-4 border-t border-[color:var(--color-border)]">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground w-full transition"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 backdrop-blur-lg bg-black/30 border-b border-[color:var(--color-border)]">
          <div className="flex items-center justify-between gap-3 px-4 md:px-8 py-3">
            <div className="md:hidden font-bold">Vocab to Anki</div>
            <div className="hidden md:block label-mono">
              {NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"))?.label ?? ""}
            </div>
            <button
              onClick={handleExport}
              className="btn-crimson flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            >
              <Download size={16} />
              <span className="hidden sm:inline">Export</span>
              <span className="rounded-full bg-black/30 px-2 py-0.5 text-xs font-mono">
                {pending}
              </span>
            </button>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 pb-24 md:pb-8 animate-in fade-in duration-300">
          {children}
        </main>
      </div>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 glass-panel-soft border-t border-[color:var(--color-border)] flex justify-around py-2">
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = pathname === n.to || pathname.startsWith(n.to + "/");
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs transition ${
                active ? "text-[color:var(--color-gold)]" : "text-muted-foreground"
              }`}
            >
              <Icon size={20} />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
