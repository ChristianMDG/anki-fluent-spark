import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

const CEFR_DESCRIPTIONS: Record<string, string> = {
  A1: "A1 Beginner (simple present tense, basic vocabulary, short clear sentences)",
  A2: "A2 Elementary (simple past narratives, daily routines, travel & hobbies)",
  B1: "B1 Intermediate (opinions, work situations, personal experiences, connectors)",
  B2: "B2 Upper-Intermediate (hypothetical scenarios, argument justification, nuanced views)",
  C1: "C1 Advanced (complex discussions, precise vocabulary, hedging & register shifts)",
  C2: "C2 Mastery (expert fluency, idiomatic expressions, subtle tone & abstract concepts)",
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

const THEME_SYSTEM = `You generate a single short, specific, engaging conversation topic appropriate for an English language learner at a specified CEFR level. Make it concrete, realistic, and interesting. Output ONLY the topic title in English, 2-6 words, no preamble, no quotes, no period, no markdown, no French.`;

export const generateSessionTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2" }) =>
    z
      .object({
        level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const levelDesc = CEFR_DESCRIPTIONS[data.level] ?? data.level;
    const user = `Target CEFR Level: ${levelDesc}.\nGenerate one specific conversation topic title now.`;
    const text = await callAI(THEME_SYSTEM, user);
    const cleaned = text.replace(/^["']|["']$/g, "").replace(/\.$/, "").trim();
    return { theme: cleaned || "Weekend plans and hobbies" };
  });

const FREE_TALK_SYSTEM = `You generate a single open-ended English speaking prompt for a learner practicing spontaneous fluency. Output ONLY the prompt itself, one or two sentences, no preamble, no quotes, no French. Make it concrete, personal, and easy to talk about for 60-90 seconds.`;
const DIALOGUE_SYSTEM = `You generate a single English opening line for a natural conversation the learner will respond to. Output ONLY the opening line, no speaker label, no preamble, no quotes, no French. Keep it casual, realistic, and clearly inviting a spoken response.`;

function buildContextSystem(
  base: string,
  opts: {
    theme?: string;
    level?: string;
    vocabularyWords?: string[];
    focusAreas?: string[];
  },
) {
  const parts: string[] = [base];
  if (opts.level && CEFR_DESCRIPTIONS[opts.level]) {
    parts.push(`Target learner level: ${CEFR_DESCRIPTIONS[opts.level]}. Adapt complexity and vocabulary accordingly.`);
  }
  if (opts.theme) {
    parts.push(`The prompt/conversation MUST fit this theme/topic: ${opts.theme}.`);
  }
  if (opts.vocabularyWords && opts.vocabularyWords.length > 0) {
    parts.push(
      `You MUST naturally incorporate these vocabulary words the learner already studied, so they get to reuse them: ${opts.vocabularyWords.join(", ")}. Weave them in without listing them.`,
    );
  }
  if (opts.focusAreas && opts.focusAreas.length > 0) {
    parts.push(
      `If natural and unforced, gently nudge the prompt or conversation toward giving the learner a chance to practice: ${opts.focusAreas.join(", ")} — but do NOT make this obvious or forced, and NEVER explicitly mention these areas to the learner.`,
    );
  }
  return parts.join("\n\n");
}

export const generateFluencyPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      type: "free_talk" | "dialogue";
      theme: string;
      level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
      vocabularyWords?: string[];
      focusAreas?: string[];
    }) =>
      z
        .object({
          type: z.enum(["free_talk", "dialogue"]),
          theme: z.string().max(200),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
          vocabularyWords: z.array(z.string().max(80)).max(5).optional(),
          focusAreas: z.array(z.string().max(80)).max(5).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const base = data.type === "free_talk" ? FREE_TALK_SYSTEM : DIALOGUE_SYSTEM;
    const system = buildContextSystem(base, {
      theme: data.theme,
      level: data.level,
      vocabularyWords: data.vocabularyWords,
      focusAreas: data.focusAreas,
    });
    const user = `Topic/Theme: ${data.theme}. CEFR Level: ${data.level}.\n\nGenerate one prompt now.`;
    const text = await callAI(system, user);
    return { prompt: text.replace(/^["']|["']$/g, "") };
  });

// ---------------------------------------------------------------------------
// Interactive dialogue: the learner speaks, the browser transcribes it via
// SpeechRecognition, and this function generates the AI's next spoken turn.
// ---------------------------------------------------------------------------

const dialogueTurnSchema = z.object({
  speaker: z.enum(["ai", "learner"]),
  text: z.string().max(600),
});

const REPLY_SYSTEM = `You are one side of a natural, realistic spoken English conversation with a language learner. You already said the opening line; the learner just replied (their reply may contain small grammar mistakes — do not correct them, just respond naturally as a real person would, staying in character and in the situation). Continue the conversation with ONE short, natural spoken reply that keeps the exchange going — ask a related follow-up, react genuinely, or shift the conversation forward. Output ONLY your line, no speaker label, no preamble, no quotes, no French, no stage directions.`;

const HINT_SYSTEM = `You help a language learner who is stuck mid-conversation. Given the conversation so far, suggest ONE short natural sentence starter (4-8 words, ending with "…") they could use to begin their next reply — just the beginning, not the full sentence, so they still have to complete it themselves. Output ONLY the starter phrase, no preamble, no quotes, no French.`;

export const generateDialogueReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      history: { speaker: "ai" | "learner"; text: string }[];
      theme: string;
      level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
      vocabularyWords?: string[];
      focusAreas?: string[];
    }) =>
      z
        .object({
          history: z.array(dialogueTurnSchema).min(1).max(20),
          theme: z.string().max(200),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
          vocabularyWords: z.array(z.string().max(80)).max(5).optional(),
          focusAreas: z.array(z.string().max(80)).max(5).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = buildContextSystem(REPLY_SYSTEM, {
      theme: data.theme,
      level: data.level,
      vocabularyWords: data.vocabularyWords,
      focusAreas: data.focusAreas,
    });
    const transcript = data.history
      .map((t) => `${t.speaker === "ai" ? "You" : "Learner"}: ${t.text}`)
      .join("\n");
    const user = `Topic: ${data.theme}\nLevel: ${data.level}\nConversation so far:\n${transcript}\n\nGive your next spoken line now.`;
    const text = await callAI(system, user);
    return { text: text.replace(/^["']|["']$/g, "") };
  });

export const generateDialogueHint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      history: { speaker: "ai" | "learner"; text: string }[];
      theme?: string;
      level?: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
    }) =>
      z
        .object({
          history: z.array(dialogueTurnSchema).min(1).max(20),
          theme: z.string().max(200).optional(),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const transcript = data.history
      .map((t) => `${t.speaker === "ai" ? "You" : "Learner"}: ${t.text}`)
      .join("\n");
    const user = `Topic: ${data.theme ?? "General"}\nConversation so far:\n${transcript}\n\nSuggest a sentence starter for the learner's next reply.`;
    const text = await callAI(HINT_SYSTEM, user);
    return { starter: text.replace(/^["']|["']$/g, "") };
  });

// ---------------------------------------------------------------------------
// Speaking feedback: called after a free-talk or dialogue exercise recording.
// Generates a single concise coaching tip in a positive, growth-oriented tone.
// ---------------------------------------------------------------------------

const SPEAKING_FEEDBACK_SYSTEM = `You are a supportive English speaking coach. Given either a free-talk prompt the learner just spoke about, or a spoken conversation transcript, generate ONE short, constructive coaching observation (1-2 sentences). Frame it positively as a growth area, never as a mistake or failure. Focus on the most useful pattern to improve (grammar, vocabulary, fluency, connectors, etc.). Output ONLY the tip, no preamble, no quotes, in English.`;

export const generateSpeakingFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      exerciseType: "free_talk" | "dialogue";
      promptText: string;
      cefrLevel: string;
      dialogueTurns?: { speaker: "ai" | "learner"; text: string }[];
    }) =>
      z
        .object({
          exerciseType: z.enum(["free_talk", "dialogue"]),
          promptText: z.string().max(500),
          cefrLevel: z.string().max(10),
          dialogueTurns: z.array(dialogueTurnSchema).max(20).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    let userPrompt: string;
    if (
      data.exerciseType === "dialogue" &&
      data.dialogueTurns &&
      data.dialogueTurns.length > 0
    ) {
      const transcript = data.dialogueTurns
        .map((t) => `${t.speaker === "ai" ? "Coach" : "Learner"}: ${t.text}`)
        .join("\n");
      userPrompt = `CEFR level: ${data.cefrLevel}\nExercise type: Dialogue\nOpening line: ${data.promptText}\nFull conversation:\n${transcript}\n\nGive one coaching tip for the learner.`;
    } else {
      userPrompt = `CEFR level: ${data.cefrLevel}\nExercise type: Free Talk\nPrompt the learner spoke about: ${data.promptText}\n\nGive one coaching tip for the learner.`;
    }
    const tip = await callAI(SPEAKING_FEEDBACK_SYSTEM, userPrompt);
    return { tip: tip.replace(/^["']|["']$/g, "") };
  });

// ---------------------------------------------------------------------------
// Extract and save weak point: classifies a coaching tip into a short 1-3
// word category, then upserts into learner_weak_points via the authenticated
// Supabase client from context (respects RLS; writes only for the caller).
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM = `You classify a language coaching tip into a short 1-3 word category tag. Output ONLY a JSON object on a single line: {"tag":"<category>","shouldTrack":<true|false>}. Use shouldTrack:false if the tip is purely positive/encouragement and does not represent a specific recurring language pattern worth tracking. Otherwise set shouldTrack:true and tag with a short lowercase label like "past tense", "prepositions", "linking words", "vocabulary range", "sentence structure", "pronunciation", "hesitation", etc.`;

const weakPointExtractSchema = z.object({
  tag: z.string().max(40),
  shouldTrack: z.boolean(),
});

export const extractAndSaveWeakPoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { tip: string }) =>
    z.object({ tip: z.string().max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: any;
      userId: string;
    };

    let parsed: { tag: string; shouldTrack: boolean };
    try {
      const raw = await callAI(EXTRACT_SYSTEM, `Coaching tip: "${data.tip}"`);
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const obj = JSON.parse(jsonMatch[0]) as unknown;
      parsed = weakPointExtractSchema.parse(obj);
    } catch {
      return;
    }

    if (!parsed.shouldTrack) return;

    const tag = parsed.tag.toLowerCase().trim().slice(0, 40);
    if (!tag) return;

    const db = supabase as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              eq: (col: string, val: boolean) => {
                maybeSingle: () => Promise<{ data: { id: string; occurrences: number } | null; error: unknown }>;
              };
            };
          };
        };
        update: (vals: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
        insert: (vals: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    };

    const { data: existing } = await db
      .from("learner_weak_points")
      .select("id, occurrences")
      .eq("user_id", userId)
      .eq("tag", tag)
      .eq("resolved", false)
      .maybeSingle();

    if (existing) {
      await db
        .from("learner_weak_points")
        .update({
          occurrences: existing.occurrences + 1,
          last_seen_at: new Date().toISOString(),
          example: data.tip.slice(0, 300),
        })
        .eq("id", existing.id);
    } else {
      await db.from("learner_weak_points").insert({
        user_id: userId,
        tag,
        example: data.tip.slice(0, 300),
        occurrences: 1,
        last_seen_at: new Date().toISOString(),
        resolved: false,
      });
    }
  });

// ---------------------------------------------------------------------------
// Listening Challenge Passage Generator
// Generates a short spoken passage, 2-3 comprehension questions, challenging
// spot tips, and a dictation sentence.
// ---------------------------------------------------------------------------

const LISTENING_SYSTEM = `You generate a short, natural spoken English passage (monologue or dialogue) on a given topic, appropriate for an English language learner at a specified CEFR level.

Output ONLY a single valid JSON object on a single line with NO markdown formatting, NO markdown backticks, NO preamble:
{
  "passage": "<text of passage, approx 80-140 words>",
  "questions": [
    {
      "question": "<comprehension question>",
      "options": ["<option 0>", "<option 1>", "<option 2>"],
      "correctIndex": <0, 1, or 2>
    }
  ],
  "challengingSpots": [
    {
      "phrase": "<exact phrase from passage>",
      "tip": "<short tip explaining connected speech, reduction, or sound feature that French speakers commonly mishear>"
    }
  ],
  "dictationSentence": "<one moderately tricky sentence from the passage suitable for a dictation test>"
}

Ensure questions test genuine comprehension (main idea, detail, or inference), NOT trivia or spelling. Options must be 3 plausible choices.`;

export interface ListeningPassageResult {
  passage: string;
  questions: Array<{
    question: string;
    options: [string, string, string];
    correctIndex: number;
  }>;
  challengingSpots: Array<{
    phrase: string;
    tip: string;
  }>;
  dictationSentence: string;
}

const listeningSchema = z.object({
  passage: z.string().min(20).max(2000),
  questions: z
    .array(
      z.object({
        question: z.string(),
        options: z.tuple([z.string(), z.string(), z.string()]),
        correctIndex: z.number().int().min(0).max(2),
      }),
    )
    .min(2)
    .max(4),
  challengingSpots: z
    .array(
      z.object({
        phrase: z.string(),
        tip: z.string(),
      }),
    )
    .default([]),
  dictationSentence: z.string(),
});

export const generateListeningPassage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      theme: string;
      level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
    }) =>
      z
        .object({
          theme: z.string().max(200),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
        })
        .parse(d),
  )
  .handler(async ({ data }): Promise<ListeningPassageResult> => {
    const userPrompt = `Topic: ${data.theme}\nCEFR Level: ${data.level}\n\nGenerate the listening passage JSON now.`;
    const raw = await callAI(LISTENING_SYSTEM, userPrompt);

    const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid response format from AI for listening passage.");
    }

    const obj = JSON.parse(jsonMatch[0]) as unknown;
    return listeningSchema.parse(obj);
  });