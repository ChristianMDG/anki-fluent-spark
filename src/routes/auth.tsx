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
    <div className="h-screen w-screen flex flex-col lg:flex-row overflow-hidden relative bg-[#060101] select-none">
      
      {/* ARRIÈRE-PLAN : CONFIGURATION VISIBILITÉ ET CADRAGE À GAUCHE */}
      <div className="absolute inset-0 w-full h-full z-0 pointer-events-none">
        <img 
          src="/itachi1.jpg" 
          alt="Itachi Mangekyou Sharingan Nightmare" 
          className="w-full h-full object-[20%_center] object-cover opacity-70 filter brightness-[0.85] contrast-[1.2] saturate-[1.05]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/20 via-[#0d0605]/30 to-[#0f0403]/90" />
        <div className="absolute inset-0 bg-radial-gradient from-transparent via-black/40 to-black/85" />
      </div>

      {/* SECTION GAUCHE : Bloc textuel avec cadre de lisibilité renforcé */}
      <div className="hidden lg:flex lg:w-[65%] h-full relative z-10 p-16 flex-col justify-between items-start pointer-events-none">
        <div className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/5">
          <div className="w-12 h-2 bg-[var(--color-crimson)] shadow-[0_0_20px_var(--color-crimson-glow)] animate-pulse" />
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--color-muted-foreground)]">
            Akatsuki Global Intelligence Network
          </span>
        </div>

        <div className="max-w-xl glass-panel-soft p-8 rounded-2xl border border-[var(--color-border)]/50 bg-black/50 backdrop-blur-lg shadow-[0_15px_50px_rgba(0,0,0,0.7)]">
          <p className="mini-title text-[var(--color-gold)] font-mono mb-2">Tsukuyomi Learning Protocol</p>
          <h2 className="text-5xl font-black text-white tracking-tight leading-none uppercase">
            Master English. <br />
            <span className="text-[var(--color-crimson)]">Control the world.</span> <br />
            Achieve peace.
          </h2>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-6 font-light max-w-sm leading-relaxed">
            Words are the ultimate genjutsu. Decode the global language, break the seals, and reach S-Class fluency.
          </p>
        </div>
      </div>

      {/* SECTION DROITE : Panneau calé à droite avec visibilité du flou augmentée */}
      <div className="w-full lg:w-[35%] h-full z-10 flex items-center justify-center lg:justify-end relative">
        {/* MODIFICATION ICI : Ajout de 'bg-black/40 backdrop-blur-md' pour adoucir le flou et assombrir légèrement le fond du verre, rendant l'interface beaucoup plus nette et lisible */}
        <div className="w-full h-full lg:h-[94vh] lg:my-[3vh] lg:mr-8 lg:rounded-2xl glass-panel bg-black/40 backdrop-blur-md flex flex-col justify-center px-8 sm:px-16 lg:px-10 xl:px-12 relative overflow-hidden">
          
          <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--color-crimson)]/5 rounded-full blur-3xl pointer-events-none" />

          <div className="w-full max-w-sm mx-auto">
            <header className="mb-8">
              <span className="text-[var(--color-gold)] text-[10px] font-mono tracking-[0.25em] uppercase block mb-1">
                Linguistic Clearance Required
              </span>
              <h1 className="text-4xl font-black text-white uppercase tracking-tight">
                {mode === "login" ? "Sign In" : "Enlist Now"}
              </h1>
            </header>
            
            <form onSubmit={submit} className="space-y-6">
              {/* Identifiant */}
              <div className="space-y-1.5">
                <label className="label-mono block text-neutral-400">Ninja Codename (Email)</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[var(--color-input)] border border-[var(--color-border)] px-4 py-3.5 rounded-xl text-sm text-[var(--color-foreground)] placeholder:text-neutral-800 focus:border-[var(--color-crimson)] focus:ring-1 focus:ring-[var(--color-ring)] outline-none transition-all duration-300 font-mono"
                  placeholder="itachi@akatsuki.org"
                />
              </div>

              {/* Mot de passe */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="label-mono block text-neutral-400">Decryption Cipher (Password)</label>
                  {mode === "login" && (
                    <a href="#" className="text-[10px] text-[var(--color-gold)] font-mono hover:underline tracking-widest">
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
                  className="w-full bg-[var(--color-input)] border border-[var(--color-border)] px-4 py-3.5 rounded-xl text-sm text-[var(--color-foreground)] placeholder:text-neutral-800 focus:border-[var(--color-crimson)] focus:ring-1 focus:ring-[var(--color-ring)] outline-none transition-all duration-300 font-mono"
                  placeholder="••••••••••••"
                />
              </div>

              {/* Bouton d'action */}
              <button 
                type="submit" 
                disabled={loading}
                className="w-full btn-crimson py-4 rounded-xl text-xs font-bold uppercase tracking-[0.2em] mt-4 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : mode === "login" ? (
                  "Initiate Training Session"
                ) : (
                  "Accept the Oath"
                )}
              </button>
            </form>

            {/* Séparateur */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-[var(--color-border)]/20" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-[#130504] px-4 font-mono text-[9px] tracking-[0.3em] text-neutral-600 uppercase">
                  Alternative Pathway
                </span>
              </div>
            </div>

            {/* Alternance Connexion / Inscription */}
            <p className="text-center text-[11px] font-mono tracking-wide text-[var(--color-muted-foreground)]">
              {mode === "login" ? "Not in the database yet?" : "Already sworn to the order?"} {" "}
              <button 
                onClick={() => setMode(mode === "login" ? "signup" : "login")} 
                className="text-[var(--color-gold)] font-bold hover:text-white transition-colors block sm:inline mt-1 sm:mt-0 uppercase underline decoration-[var(--color-border)] underline-offset-4 ml-1"
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