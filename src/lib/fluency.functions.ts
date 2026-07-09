import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

const SITUATION_HINTS: Record<string, string> = {
  social: "casual social interactions (small talk, meeting friends, parties, hobbies)",
  transactional: "practical transactions (shops, restaurants, travel, admin, services)",
  professional:
    "professional situations that are NOT job interviews (meetings, colleagues, workplace chat, presentations)",
  emotional:
    "emotional conversations (feelings, empathy, personal issues, conflicts, support)",
  narrative: "narrative and creative storytelling (anecdotes, imaginative scenes, memories)",
};

const COMPLEXITY_HINTS: Record<number, string> = {
  1: "Level 1 — DESCRIBE: describe people, places, objects, routines in the present tense with simple, clear sentences.",
  2: "Level 2 — NARRATE: tell a story or event with proper sequencing, past tenses, and connectors.",
  3: "Level 3 — ARGUE: give a clear opinion and justify it with reasons, examples, and counterpoints.",
  4: "Level 4 — HYPOTHESIZE: use conditionals and speculation (what would you do if…, imagine that…).",
  5: "Level 5 — NUANCE: use nuanced language, hedging, subtle tone, idioms, and precise register shifts.",
};

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

const FREE_TALK_SYSTEM = `You generate a single open-ended English speaking prompt for a learner practicing spontaneous fluency. Output ONLY the prompt itself, one or two sentences, no preamble, no quotes, no French. Make it concrete, personal, and easy to talk about for 60-90 seconds.`;
const DIALOGUE_SYSTEM = `You generate a single English opening line for a natural conversation the learner will respond to. Output ONLY the opening line, no speaker label, no preamble, no quotes, no French. Keep it casual, realistic, and clearly inviting a spoken response.`;

function buildContextSystem(
  base: string,
  opts: {
    situation?: string;
    complexityLevel?: number;
    vocabularyWords?: string[];
  },
) {
  const parts: string[] = [base];
  if (opts.situation && SITUATION_HINTS[opts.situation]) {
    parts.push(
      `The prompt MUST fit this situation: ${SITUATION_HINTS[opts.situation]}.`,
    );
  }
  if (opts.complexityLevel && COMPLEXITY_HINTS[opts.complexityLevel]) {
    parts.push(
      `The prompt MUST target this linguistic complexity: ${COMPLEXITY_HINTS[opts.complexityLevel]}`,
    );
  }
  if (opts.vocabularyWords && opts.vocabularyWords.length > 0) {
    parts.push(
      `You MUST naturally incorporate these vocabulary words the learner already studied, so they get to reuse them: ${opts.vocabularyWords.join(", ")}. Weave them in without listing them.`,
    );
  }
  return parts.join("\n\n");
}

export const generateFluencyPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      type: "free_talk" | "dialogue";
      weekTheme: string;
      situation?: "social" | "transactional" | "professional" | "emotional" | "narrative";
      complexityLevel?: number;
      vocabularyWords?: string[];
    }) =>
      z
        .object({
          type: z.enum(["free_talk", "dialogue"]),
          weekTheme: z.string().max(200),
          situation: z
            .enum(["social", "transactional", "professional", "emotional", "narrative"])
            .optional(),
          complexityLevel: z.number().int().min(1).max(5).optional(),
          vocabularyWords: z.array(z.string().max(80)).max(5).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const base = data.type === "free_talk" ? FREE_TALK_SYSTEM : DIALOGUE_SYSTEM;
    const system = buildContextSystem(base, {
      situation: data.situation,
      complexityLevel: data.complexityLevel,
      vocabularyWords: data.vocabularyWords,
    });
    const contextLine = data.situation
      ? `Situation: ${data.situation}. Complexity level: ${data.complexityLevel ?? "unspecified"}.`
      : `Weekly theme: ${data.weekTheme}`;
    const user = `${contextLine}\n\nGenerate one prompt now.`;
    const text = await callAI(system, user);
    return { prompt: text.replace(/^["']|["']$/g, "") };
  });
