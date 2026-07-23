import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Home, Sparkles, Video, Download, LogOut, Library, Mic, Compass } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { downloadTsv } from "@/lib/tsv-export";
import { toast } from "sonner";
import { VideoPlayerProvider } from "@/lib/video-player-context";

const NAV = [
  { to: "/home", label: "Dashboard", icon: Home },
  { to: "/library", label: "Library", icon: Library },
  { to: "/shadowing", label: "Shadowing", icon: Video },
  { to: "/parcours", label: "Parcours", icon: Compass },
  { to: "/fluency", label: "Fluency", icon: Mic },
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
    <VideoPlayerProvider>
      {/* Viewport locked to h-screen to handle inner scrolling without horizontal leaks */}
      <div className="min-h-screen md:h-screen flex flex-col md:grid md:grid-cols-[240px_1fr] bg-[#050101] text-white selection:bg-[var(--color-crimson)] selection:text-white select-none overflow-hidden">
        
        {/* INJECTED STYLE: Audiowide Import & Sidebar HUD Enhancements */}
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');
          
          .font-audiowide {
            font-family: 'Audiowide', sans-serif;
          }
          @keyframes borderPulse {
            0%, 100% { border-color: rgba(237, 28, 36, 0.12); }
            50% { border-color: rgba(237, 28, 36, 0.4); }
          }
          .hud-pulse-border {
            animation: borderPulse 4s infinite ease-in-out;
          }
        `}</style>

        {/* SIDEBAR: Absolute layout anchor on Desktop */}
        <aside className="hidden md:flex md:flex-col md:w-[240px] h-screen bg-black/40 backdrop-blur-md border-r border-[var(--color-border)]/40 p-4 gap-1.5 z-30 hud-pulse-border shrink-0 box-border">
          
          {/* Organization Logo Header */}
          <div className="mb-6 px-2 border-b border-white/5 pb-4">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-crimson)] shadow-[0_0_6px_var(--color-crimson)]" />
              <p className="font-audiowide text-[10px] tracking-[0.25em] text-[var(--color-gold)] uppercase">Akatsuki</p>
            </div>
            <p className="font-audiowide text-base font-black tracking-wider mt-0.5 text-white uppercase">
             <span className="text-[var(--color-crimson)]"> I-</span>Speak
            </p>
          </div>

          {/* Navigation Links */}
          <div className="space-y-1 flex-1 overflow-y-auto pr-1 scrollbar-none">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = pathname === n.to || pathname.startsWith(n.to + "/");
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl font-audiowide text-[11px] uppercase tracking-wider transition-all duration-300 relative overflow-hidden border group ${
                    active
                      ? "bg-[var(--color-crimson)]/15 text-white border-[var(--color-crimson)]/50 shadow-[0_0_15px_rgba(237,28,36,0.15)] translate-x-1"
                      : "text-neutral-400 border-transparent hover:text-white hover:bg-white/5 hover:translate-x-1"
                  }`}
                >
                  <Icon size={16} className={`transition-transform duration-300 group-hover:scale-110 ${active ? "text-[var(--color-crimson)]" : "text-neutral-400 group-hover:text-white"}`} />
                  {n.label}
                </Link>
              );
            })}
          </div>

          {/* Sign Out Base Anchor */}
          <div className="mt-auto pt-4 border-t border-[var(--color-border)]/30">
            <button
              onClick={handleSignOut}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl font-audiowide text-[11px] uppercase tracking-wider text-neutral-500 hover:text-[var(--color-crimson)] w-full transition-colors duration-300 group"
            >
              <LogOut size={15} className="transition-transform group-hover:-translate-x-0.5" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* MAIN BODY WRAPPER: Handles viewport routing and context separation */}
        <div className="flex-1 flex flex-col min-w-0 h-screen relative z-10 overflow-hidden">
          
          {/* HEADER: Top Operational Control Room (Locked to top on all devices) */}
          <header className="sticky top-0 z-20 backdrop-blur-xl bg-black/50 border-b border-[var(--color-border)]/40 shadow-lg w-full shrink-0">
            <div className="flex items-center justify-between gap-3 px-4 md:px-8 py-3.5">
              
              {/* Mobile Title */}
              <div className="md:hidden font-audiowide text-sm font-black uppercase tracking-wider">
                Vocab <span className="text-[var(--color-crimson)]">to</span> Anki
              </div>
              
              {/* Desktop Current Active Route Section Title */}
              <div className="hidden md:block font-audiowide text-xs tracking-[0.2em] text-[var(--color-gold)] uppercase">
                // {NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"))?.label ?? "System"}
              </div>

              {/* Data Extraction / Export Core Action */}
              <button
                onClick={handleExport}
                className="btn-crimson font-audiowide text-[11px] tracking-widest uppercase flex items-center gap-2.5 rounded-xl px-4 py-2 shadow-[0_4px_20px_rgba(237,28,36,0.2)] hover:shadow-[0_4px_25px_rgba(237,28,36,0.4)] transition-all duration-300"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Export Intel</span>
                <span className="rounded-md bg-black/50 border border-white/10 px-1.5 py-0.5 text-[9px] font-mono text-[var(--color-gold)]">
                  {pending}
                </span>
              </button>
            </div>
          </header>

          {/* VIEWPORT CONTROLLER MAIN CONTENT: Handles isolated vertical scrolling */}
          <main className="flex-1 overflow-y-auto px-4 md:px-8 py-6 pb-28 md:pb-8 animate-in fade-in duration-500 w-full box-border custom-scrollbar">
            {children}
          </main>
        </div>

        {/* NAVIGATION: Mobile Bottom Navigation Strip */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-black/80 backdrop-blur-xl border-t border-[var(--color-border)]/40 flex justify-around py-2 px-1 pb-[calc(env(safe-area-inset-bottom)+8px)] shadow-[0_-10px_35px_rgba(0,0,0,0.9)] w-full left-0 right-0">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = pathname === n.to || pathname.startsWith(n.to + "/");
            return (
              <Link
                key={n.to}
                to={n.to}
                className={`flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-xl transition-all duration-200 active:scale-95 ${
                  active ? "text-[var(--color-gold)]" : "text-neutral-500"
                }`}
              >
                <Icon size={18} className={active ? "drop-shadow-[0_0_5px_rgba(255,184,0,0.4)]" : ""} />
                <span className="font-audiowide text-[8px] tracking-wider uppercase">{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </VideoPlayerProvider>
  );
}