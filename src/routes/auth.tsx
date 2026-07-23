import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Member registered. Welcome to the Akatsuki Language Corps.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/home" });
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen w-screen flex flex-col lg:flex-row overflow-hidden relative bg-[#050101] select-none perspective-1000">
      {/* STYLE INJECTÉ : Import Audiowide, Distorsion d'Espace et Flou Directionnel */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');`}</style>

      {/* ARRIÈRE-PLAN : Stabilisation du vortex de la pupille */}
      <div className="absolute inset-0 w-full h-full z-0 pointer-events-none">
        <img
          src="/itachi1.jpg"
          alt="Itachi Mangekyou Sharingan Nightmare"
          className="w-full h-full object-[20%_center] object-cover animate-vortex"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-[#0a0302]/40 to-[#0e0201]" />
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-black/50 to-[#050101]" />
      </div>

      {/* SECTION GAUCHE : Apparition focus */}
      <div className="hidden lg:flex lg:w-[65%] h-full relative z-10 p-16 flex-col justify-between items-start pointer-events-none">
        <div
          className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/5 animate-focus-cascade"
          style={{ "--delay": "0.5s" } as React.CSSProperties}
        >
          <div className="w-6 h-[1px] bg-[var(--color-crimson)] shadow-[0_0_10px_var(--color-crimson)]" />
          <span className="font-audiowide text-xs uppercase tracking-[0.3em] text-[var(--color-muted-foreground)]">
           Welcome To I-Speak
          </span>
        </div>

        <div
          className="max-w-xl glass-panel-soft p-8 rounded-2xl border border-[var(--color-border)]/50 bg-black/50 backdrop-blur-lg shadow-[0_15px_50px_rgba(0,0,0,0.7)] animate-focus-cascade"
          style={{ "--delay": "0.7s" } as React.CSSProperties}
        >
          <p className="mini-title text-[var(--color-gold)] font-audiowide text-xs tracking-wider mb-2">
            Tsukuyomi Learning Protocol
          </p>
          <h2 className="font-audiowide text-3xl xl:text-4xl font-black text-white tracking-wide leading-tight uppercase">
            Master English. <br />
            <span className="text-[var(--color-crimson)]">Explore the world.</span> <br />
            Achieve Your Goal.
          </h2>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-6 font-light max-w-sm leading-relaxed">
            Words are the ultimate genjutsu. Decode the global language, break the seals, and reach
            S-Class fluency.
          </p>
        </div>
      </div>

      {/* SECTION DROITE : Bascule 3D du Panneau depuis l'arrière-plan */}
      <div className="w-full lg:w-[35%] h-full z-10 flex items-center justify-center lg:justify-end relative">
        <div className="w-full h-full lg:h-[94vh] lg:my-[3vh] lg:mr-8 lg:rounded-2xl glass-panel bg-black/40 backdrop-blur-md flex flex-col justify-center px-8 sm:px-16 lg:px-10 xl:px-12 relative overflow-hidden animate-flip-in shadow-[0_30px_100px_rgba(0,0,0,0.9)]">
          <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--color-crimson)]/5 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-sm mx-auto relative z-10">
            {/* EN-TÊTE */}
            <header
              className="mb-8 animate-focus-cascade"
              style={{ "--delay": "0.6s" } as React.CSSProperties}
            >
              <span className="text-[var(--color-gold)] text-[10px] font-audiowide tracking-[0.25em] uppercase block mb-1">
                Linguistic Clearance Required
              </span>
              <h1 className="font-audiowide text-4xl font-black text-white uppercase tracking-tight">
                {mode === "login" ? "Sign In" : "Enlist Now"}
              </h1>
            </header>

            <form onSubmit={submit} className="space-y-6">
              {/* CODE NOM (EMAIL) */}
              <div
                className="space-y-1.5 animate-focus-cascade"
                style={{ "--delay": "0.7s" } as React.CSSProperties}
              >
                <label className="font-audiowide text-xs tracking-wider block text-neutral-400">
                  Ninja Codename (Email)
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[var(--color-input)] border border-[var(--color-border)] px-4 py-3.5 rounded-xl text-sm text-[var(--color-foreground)] placeholder:text-neutral-800 focus:border-[var(--color-crimson)] focus:ring-1 focus:ring-[var(--color-ring)] outline-none transition-all duration-500 font-mono focus:bg-black/60 focus:scale-[1.01]"
                  placeholder="itachi@akatsuki.org"
                />
              </div>

              {/* MOT DE PASSE */}
              <div
                className="space-y-1.5 animate-focus-cascade"
                style={{ "--delay": "0.8s" } as React.CSSProperties}
              >
                <div className="flex justify-between items-center">
                  <label className="font-audiowide text-xs tracking-wider block text-neutral-400">
                    Decryption Cipher
                  </label>
                  {mode === "login" && (
                    <a
                      href="#"
                      className="text-[10px] text-[var(--color-gold)] font-audiowide hover:underline tracking-widest"
                    >
                      [ Lost Seal? ]
                    </a>
                  )}
                </div>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[var(--color-input)] border border-[var(--color-border)] px-4 py-3.5 rounded-xl text-sm text-[var(--color-foreground)] placeholder:text-neutral-800 focus:border-[var(--color-crimson)] focus:ring-1 focus:ring-[var(--color-ring)] outline-none transition-all duration-500 font-mono focus:bg-black/60 focus:scale-[1.01]"
                  placeholder="••••••••••••"
                />
              </div>

              {/* BUTTON */}
              <div
                className="animate-focus-cascade"
                style={{ "--delay": "0.9s" } as React.CSSProperties}
              >
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full font-audiowide btn-crimson py-4 rounded-xl text-xs font-bold uppercase tracking-[0.2em] mt-2 flex items-center justify-center gap-2 cursor-pointer transition-all duration-300 hover:tracking-[0.25em] active:translate-y-[1px]"
                >
                  {loading ? (
                    <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  ) : mode === "login" ? (
                    "Initiate Training Session"
                  ) : (
                    "Accept the Oath"
                  )}
                </button>
              </div>
            </form>

            {/* SÉPARATEUR */}
            <div
              className="relative my-8 animate-focus-cascade"
              style={{ "--delay": "1s" } as React.CSSProperties}
            >
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-[var(--color-border)]/20" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-[#130504] px-4 font-audiowide text-[9px] tracking-[0.3em] text-neutral-600 uppercase">
                  Alternative Pathway
                </span>
              </div>
            </div>

            {/* INTERRUPTEUR DE MODE */}
            <p
              className="text-center text-[11px] font-audiowide tracking-wide text-[var(--color-muted-foreground)] animate-focus-cascade"
              style={{ "--delay": "1.1s" } as React.CSSProperties}
            >
              {mode === "login" ? "Not in the database yet?" : "Already sworn to the order?"}{" "}
              <button
                onClick={() => setMode(mode === "login" ? "signup" : "login")}
                className="text-[var(--color-gold)] font-bold hover:text-white transition-colors block sm:inline mt-1 sm:mt-0 uppercase underline decoration-[var(--color-border)] underline-offset-4 ml-1 cursor-pointer font-audiowide text-[10px]"
              >
                {mode === "login" ? "Create a Profile" : "Authenticate Session"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
