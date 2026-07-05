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
        toast.success("Compte créé ! Tu peux te connecter.");
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
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass-panel w-full max-w-md p-8">
        <div className="text-center mb-6">
          <p className="label-mono text-[color:var(--color-gold)]">Akatsuki</p>
          <h1 className="text-3xl font-bold mt-2">Vocab to Anki</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {mode === "login" ? "Connecte-toi pour continuer" : "Crée ton compte"}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label-mono block mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full glass-panel-soft px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-crimson-glow)]"
              placeholder="ton@email.fr"
            />
          </div>
          <div>
            <label className="label-mono block mb-1.5">Mot de passe</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full glass-panel-soft px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-crimson-glow)]"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-crimson w-full rounded-lg py-3 font-medium"
          >
            {loading ? "…" : mode === "login" ? "Se connecter" : "Créer le compte"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground transition"
        >
          {mode === "login" ? "Pas encore de compte ? Créer un compte" : "J'ai déjà un compte"}
        </button>
      </div>
    </div>
  );
}
