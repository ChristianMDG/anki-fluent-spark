import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

async function callAI(system: string, user: string): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI Gateway ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

const FREE_TALK_SYSTEM = `You generate a single open-ended English speaking prompt for a learner practicing spontaneous fluency. Output ONLY the prompt itself, one or two sentences, no preamble, no quotes, no French. Make it concrete, personal, and easy to talk about for 60-90 seconds. Vary phrasing (question, scenario, or invitation).`;

const DIALOGUE_SYSTEM = `You generate a single English opening line for a natural conversation the learner will respond to. Output ONLY the opening line, no speaker label, no preamble, no quotes, no French. Keep it casual, realistic, and clearly inviting a spoken response.`;

export const generateFluencyPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { type: "free_talk" | "dialogue"; weekTheme: string }) =>
    z
      .object({
        type: z.enum(["free_talk", "dialogue"]),
        weekTheme: z.string().max(200),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const system = data.type === "free_talk" ? FREE_TALK_SYSTEM : DIALOGUE_SYSTEM;
    const user = `Weekly theme: ${data.weekTheme}\n\nGenerate one prompt now.`;
    const text = await callAI(system, user);
    return { prompt: text.replace(/^["']|["']$/g, "") };
  });
