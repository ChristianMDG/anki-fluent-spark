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

function parseJsonFromText<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?|```/gi, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("Failed to parse JSON response from AI");
  }
  return JSON.parse(jsonMatch[0]) as T;
}

// ---------------------------------------------------------------------------
// 1. Choice of correct usage
// ---------------------------------------------------------------------------

const usageChoiceSentenceSchema = z.object({
  text: z.string(),
  correct: z.boolean(),
  whyWrong: z.string().optional().default(""),
});

const usageChoiceResponseSchema = z.object({
  sentences: z.array(usageChoiceSentenceSchema).length(3),
});

export const generateUsageChoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; definition: string; level: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          definition: z.string().max(500),
          level: z.string().max(10),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You create language learning exercises. Given a target English word, its definition, and target CEFR level, generate 3 short, realistic daily-life sentences.
Criteria:
- Exactly ONE sentence MUST be correct and natural.
- Exactly TWO sentences MUST contain common, realistic errors that a French speaker learning English would plausibly make with this specific word (e.g. wrong preposition, wrong collocation, false-friend confusion, wrong verb form or tense).
- For each incorrect sentence, provide a clear, 1-sentence explanation in English ('whyWrong') explaining what was wrong. For the correct sentence, 'whyWrong' should be empty ("").

Output ONLY valid JSON matching this structure:
{
  "sentences": [
    { "text": "...", "correct": true, "whyWrong": "" },
    { "text": "...", "correct": false, "whyWrong": "..." },
    { "text": "...", "correct": false, "whyWrong": "..." }
  ]
}`;

    const user = `Target Word: "${data.word}"\nDefinition: "${data.definition}"\nTarget CEFR Level: ${data.level}\n\nGenerate the 3 sentences now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{ sentences: { text: string; correct: boolean; whyWrong?: string }[] }>(raw);
      return usageChoiceResponseSchema.parse(parsed);
    } catch {
      // Fallback if parsing fails
      return {
        sentences: [
          { text: `I need to ${data.word} this right away.`, correct: true, whyWrong: "" },
          { text: `I need to ${data.word} on this right away.`, correct: false, whyWrong: `Incorrect preposition used with '${data.word}'.` },
          { text: `I am ${data.word}ing for this right now.`, correct: false, whyWrong: `Incorrect grammatical construction with '${data.word}'.` },
        ],
      };
    }
  });

// ---------------------------------------------------------------------------
// 2. Error correction
// ---------------------------------------------------------------------------

const errorCorrectionResponseSchema = z.object({
  incorrectSentence: z.string(),
  correctSentence: z.string(),
  errorType: z.string(),
});

export const generateErrorCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; definition: string; level: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          definition: z.string().max(500),
          level: z.string().max(10),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You create error correction exercises for English language learners. Given a target word, its definition, and target CEFR level, generate ONE sentence containing a plausible daily-life mistake using that word (typical for a French native speaker), along with the correct version and a short error type label.

Output ONLY valid JSON:
{
  "incorrectSentence": "...",
  "correctSentence": "...",
  "errorType": "..."
}
(errorType should be a short label like 'wrong preposition', 'wrong tense', 'false friend', 'word order', 'collocation')`;

    const user = `Target Word: "${data.word}"\nDefinition: "${data.definition}"\nLevel: ${data.level}\n\nGenerate one error correction exercise now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{ incorrectSentence: string; correctSentence: string; errorType: string }>(raw);
      return errorCorrectionResponseSchema.parse(parsed);
    } catch {
      return {
        incorrectSentence: `She ${data.word}ed about the problem yesterday.`,
        correctSentence: `She ${data.word} the problem yesterday.`,
        errorType: "wrong preposition",
      };
    }
  });

const checkCorrectionResponseSchema = z.object({
  isCorrect: z.boolean(),
  feedback: z.string(),
});

export const checkCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { learnerAnswer: string; incorrectSentence: string; correctSentence: string }) =>
      z
        .object({
          learnerAnswer: z.string().min(1).max(500),
          incorrectSentence: z.string().max(500),
          correctSentence: z.string().max(500),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You evaluate a language learner's correction of an English sentence.
Original incorrect sentence: "${data.incorrectSentence}"
Reference correct sentence: "${data.correctSentence}"
Learner's submitted correction: "${data.learnerAnswer}"

Rules for grading:
- Be strict but fair.
- Accept valid alternative phrasings that successfully fix the error without introducing new errors.
- Reject answers that fail to fix the original mistake or introduce new grammatical, spelling, or punctuation errors.
- Provide a brief 1-2 sentence constructive feedback message explaining why the answer is correct or what was missed/wrong.

Output ONLY valid JSON:
{
  "isCorrect": true|false,
  "feedback": "..."
}`;

    const user = `Evaluate learner's correction now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{ isCorrect: boolean; feedback: string }>(raw);
      return checkCorrectionResponseSchema.parse(parsed);
    } catch {
      const isMatch = data.learnerAnswer.trim().toLowerCase() === data.correctSentence.trim().toLowerCase();
      return {
        isCorrect: isMatch,
        feedback: isMatch
          ? "Great job! Your correction is accurate."
          : `The expected correction was: "${data.correctSentence}".`,
      };
    }
  });

// ---------------------------------------------------------------------------
// 3. Free construction
// ---------------------------------------------------------------------------

const dailyContextResponseSchema = z.object({
  context: z.string(),
});

export const generateDailyContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; level: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          level: z.string().max(10),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You create short speaking/writing prompts for language practice. Output a single 1-line realistic daily-life scenario prompt asking the learner to write a sentence using a target word at their CEFR level.

Output ONLY valid JSON:
{
  "context": "..."
}
Example context: "Use this word while telling a coworker about your weekend" or "Use this word when complaining about traffic to a friend".`;

    const user = `Target Word: "${data.word}"\nTarget Level: ${data.level}\n\nGenerate the context prompt now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{ context: string }>(raw);
      return dailyContextResponseSchema.parse(parsed);
    } catch {
      return {
        context: `Use "${data.word}" in a sentence describing a recent situation at work or home.`,
      };
    }
  });

const evaluateFreeSentenceResponseSchema = z.object({
  grammaticallyCorrect: z.boolean(),
  naturalness: z.enum(["natural", "a bit awkward", "not quite right"]),
  feedback: z.string(),
  improvedVersion: z.string(),
});

export const evaluateFreeSentence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; context: string; learnerSentence: string; level: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          context: z.string().max(500),
          learnerSentence: z.string().min(1).max(600),
          level: z.string().max(10),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You are a supportive, constructive English language coach.
The learner was given the target word "${data.word}" and the context prompt: "${data.context}".
They wrote: "${data.learnerSentence}".
Learner CEFR level: ${data.level}.

Tasks:
1. Check if the sentence is grammatically correct.
2. Assess naturalness: "natural", "a bit awkward", or "not quite right".
3. Provide ONE concise piece of feedback framed positively and encouragingly (1-2 sentences).
4. Provide ONE improved/polished version of the sentence for comparison.

Output ONLY valid JSON:
{
  "grammaticallyCorrect": true|false,
  "naturalness": "natural" | "a bit awkward" | "not quite right",
  "feedback": "...",
  "improvedVersion": "..."
}`;

    const user = `Evaluate the sentence now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{
        grammaticallyCorrect: boolean;
        naturalness: "natural" | "a bit awkward" | "not quite right";
        feedback: string;
        improvedVersion: string;
      }>(raw);
      return evaluateFreeSentenceResponseSchema.parse(parsed);
    } catch {
      return {
        grammaticallyCorrect: true,
        naturalness: "natural",
        feedback: "Good effort! Your sentence expresses the idea clearly.",
        improvedVersion: data.learnerSentence,
      };
    }
  });
