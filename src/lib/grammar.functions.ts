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

export const highlightedSegmentSchema = z.object({
  text: z.string(),
  isError: z.boolean(),
});

export type HighlightedSegment = z.infer<typeof highlightedSegmentSchema>;

// ---------------------------------------------------------------------------
// 0. Extract & Save Grammar Error Pattern
// ---------------------------------------------------------------------------

const EXTRACT_GRAMMAR_PATTERN_SYSTEM = `You classify feedback or error details from an English language learning exercise into a short, normalized grammar error pattern tag. Output ONLY a JSON object on a single line: {"tag":"<category>","shouldTrack":<true|false>}. Set shouldTrack:false if the feedback indicates no error or is purely general praise. Otherwise set shouldTrack:true and tag with a concise, lowercase label like "prepositions", "word order", "verb tense", "article usage", "subject-verb agreement", "modal verbs", "passive voice", "pluralization", "gerund vs infinitive", "adjective placement", "false friend", "collocation", etc.`;

const extractGrammarPatternSchema = z.object({
  tag: z.string().max(40),
  shouldTrack: z.boolean(),
});

export const extractGrammarPattern = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { feedbackOrErrorType: string }) =>
    z.object({ feedbackOrErrorType: z.string().max(600) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: any;
      userId: string;
    };

    let parsed: { tag: string; shouldTrack: boolean };
    try {
      const raw = await callAI(
        EXTRACT_GRAMMAR_PATTERN_SYSTEM,
        `Feedback / Error detail: "${data.feedbackOrErrorType}"`,
      );
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;
      const obj = JSON.parse(jsonMatch[0]) as unknown;
      parsed = extractGrammarPatternSchema.parse(obj);
    } catch {
      return;
    }

    if (!parsed.shouldTrack) return;

    const tag = parsed.tag.toLowerCase().trim().slice(0, 40);
    if (!tag) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: existing } = await db
      .from("grammar_error_patterns")
      .select("id, occurrences")
      .eq("user_id", userId)
      .eq("pattern_tag", tag)
      .maybeSingle();

    if (existing) {
      await db
        .from("grammar_error_patterns")
        .update({
          occurrences: existing.occurrences + 1,
          last_seen_at: new Date().toISOString(),
          resolved: false,
        })
        .eq("id", existing.id);
    } else {
      await db.from("grammar_error_patterns").insert({
        user_id: userId,
        pattern_tag: tag,
        occurrences: 1,
        last_seen_at: new Date().toISOString(),
        resolved: false,
      });
    }
  });

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
    (d: { word: string; definition: string; level: string; focusPattern?: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          definition: z.string().max(500),
          level: z.string().max(10),
          focusPattern: z.string().max(100).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const focusInstruction = data.focusPattern
      ? `NOTE: Focus on giving the learner subtle practice with "${data.focusPattern}" without explicitly naming this pattern to the learner.`
      : "";

    const system = `You create language learning exercises. Given a target English word, its definition, and target CEFR level, generate 3 short, realistic daily-life sentences.
Criteria:
- Exactly ONE sentence MUST be correct and natural.
- Exactly TWO sentences MUST contain common, realistic errors that a learner would plausibly make with this specific word (e.g. wrong preposition, wrong collocation, false-friend confusion, wrong verb form or tense).
- For each incorrect sentence, provide a clear, 1-sentence explanation in English ('whyWrong') explaining what was wrong. For the correct sentence, 'whyWrong' should be empty ("").
${focusInstruction}

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
    (d: { word: string; definition: string; level: string; focusPattern?: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          definition: z.string().max(500),
          level: z.string().max(10),
          focusPattern: z.string().max(100).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const focusInstruction = data.focusPattern
      ? `NOTE: If possible, construct the mistake around the error pattern "${data.focusPattern}".`
      : "";

    const system = `You create error correction exercises for English language learners. Given a target word, its definition, and target CEFR level, generate ONE sentence containing a plausible daily-life mistake using that word, along with the correct version and a short error type label.
${focusInstruction}

Output ONLY valid JSON:
{
  "incorrectSentence": "...",
  "correctSentence": "...",
  "errorType": "..."
}
(errorType should be a short label like 'wrong preposition', 'wrong tense', 'word order', 'collocation')`;

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
  highlightedAnswer: z.array(highlightedSegmentSchema).optional(),
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
- Reject answers that fail to fix the original mistake or introduce new errors.
- Provide a brief 1-2 sentence constructive feedback message.
- If the learner's answer is NOT correct, provide "highlightedAnswer": an array of segments splitting the exact string "${data.learnerAnswer}" into parts, setting isError: true on the specific word(s) or phrase that caused the mistake or remained incorrect, and isError: false on the rest.

Output ONLY valid JSON:
{
  "isCorrect": true|false,
  "feedback": "...",
  "highlightedAnswer": [
    { "text": "...", "isError": false },
    { "text": "...", "isError": true }
  ]
}`;

    const user = `Evaluate learner's correction now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{
        isCorrect: boolean;
        feedback: string;
        highlightedAnswer?: { text: string; isError: boolean }[];
      }>(raw);
      return checkCorrectionResponseSchema.parse(parsed);
    } catch {
      const isMatch = data.learnerAnswer.trim().toLowerCase() === data.correctSentence.trim().toLowerCase();
      return {
        isCorrect: isMatch,
        feedback: isMatch
          ? "Great job! Your correction is accurate."
          : `The expected correction was: "${data.correctSentence}".`,
        highlightedAnswer: isMatch
          ? undefined
          : [{ text: data.learnerAnswer, isError: true }],
      };
    }
  });

// ---------------------------------------------------------------------------
// 3. Sentence Transformation Exercises
// ---------------------------------------------------------------------------

const transformationResponseSchema = z.object({
  originalSentence: z.string(),
  instruction: z.string(),
  expectedTransformation: z.string(),
});

export const generateTransformation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; definition: string; level: string; focusPattern?: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          definition: z.string().max(500),
          level: z.string().max(10),
          focusPattern: z.string().max(100).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const focusInstruction = data.focusPattern
      ? `NOTE: Incorporate the error pattern or grammar focus "${data.focusPattern}" into the transformation instruction if natural.`
      : "";

    const system = `You create sentence transformation exercises for English learners. Given a target word, definition, level, and optional focus pattern, create:
1. "originalSentence": A natural daily-life sentence incorporating the target word.
2. "instruction": A clear transformation command (e.g. "Rewrite in the past tense", "Turn this into a question", "Rewrite in the passive voice", "Rewrite using a conditional sentence", "Change to a negative statement"). Vary the transformation type naturally.
3. "expectedTransformation": The correct transformed version of the sentence.
${focusInstruction}

Output ONLY valid JSON:
{
  "originalSentence": "...",
  "instruction": "...",
  "expectedTransformation": "..."
}`;

    const user = `Target Word: "${data.word}"\nDefinition: "${data.definition}"\nLevel: ${data.level}\n\nGenerate one sentence transformation exercise now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{
        originalSentence: string;
        instruction: string;
        expectedTransformation: string;
      }>(raw);
      return transformationResponseSchema.parse(parsed);
    } catch {
      return {
        originalSentence: `She uses this ${data.word} every single day.`,
        instruction: "Rewrite in the simple past tense",
        expectedTransformation: `She used this ${data.word} every single day.`,
      };
    }
  });

const checkTransformationResponseSchema = z.object({
  isCorrect: z.boolean(),
  feedback: z.string(),
  highlightedAnswer: z.array(highlightedSegmentSchema).optional(),
});

export const checkTransformation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      learnerAnswer: string;
      originalSentence: string;
      instruction: string;
      expectedTransformation: string;
    }) =>
      z
        .object({
          learnerAnswer: z.string().min(1).max(500),
          originalSentence: z.string().max(500),
          instruction: z.string().max(300),
          expectedTransformation: z.string().max(500),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You evaluate a language learner's sentence transformation.
Original sentence: "${data.originalSentence}"
Instruction: "${data.instruction}"
Expected transformation: "${data.expectedTransformation}"
Learner's answer: "${data.learnerAnswer}"

Rules for grading:
- Be non-strict: Accept valid alternative phrasings that fulfill the transformation instruction correctly without introducing new grammatical errors.
- Reject answers that fail to fulfill the transformation or contain grammatical/spelling mistakes.
- Provide a brief 1-2 sentence constructive feedback message.
- If NOT correct, provide "highlightedAnswer": an array of segments splitting the exact string "${data.learnerAnswer}" into parts, setting isError: true on the specific word(s) or phrase that caused the mistake, and isError: false on the rest.

Output ONLY valid JSON:
{
  "isCorrect": true|false,
  "feedback": "...",
  "highlightedAnswer": [
    { "text": "...", "isError": false },
    { "text": "...", "isError": true }
  ]
}`;

    const user = `Evaluate transformation now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{
        isCorrect: boolean;
        feedback: string;
        highlightedAnswer?: { text: string; isError: boolean }[];
      }>(raw);
      return checkTransformationResponseSchema.parse(parsed);
    } catch {
      const isMatch =
        data.learnerAnswer.trim().toLowerCase() === data.expectedTransformation.trim().toLowerCase();
      return {
        isCorrect: isMatch,
        feedback: isMatch
          ? "Great job transforming the sentence!"
          : `Expected: "${data.expectedTransformation}"`,
        highlightedAnswer: isMatch ? undefined : [{ text: data.learnerAnswer, isError: true }],
      };
    }
  });

// ---------------------------------------------------------------------------
// 4. Free Construction & Mini-Paragraph
// ---------------------------------------------------------------------------

const dailyContextResponseSchema = z.object({
  context: z.string(),
});

export const generateDailyContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; level: string; focusPattern?: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          level: z.string().max(10),
          focusPattern: z.string().max(100).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const focusInstruction = data.focusPattern
      ? `NOTE: Craft the prompt scenario so it naturally gives an opportunity to practice "${data.focusPattern}".`
      : "";

    const system = `You create short speaking/writing prompts for language practice. Output a single 1-line realistic daily-life scenario prompt asking the learner to write a sentence using a target word at their CEFR level.
${focusInstruction}

Output ONLY valid JSON:
{
  "context": "..."
}`;

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

export const generateMultiWordContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { words: { word: string; definition: string }[]; level: string; focusPattern?: string }) =>
      z
        .object({
          words: z
            .array(
              z.object({
                word: z.string().min(1).max(100),
                definition: z.string().max(500),
              }),
            )
            .min(2)
            .max(5),
          level: z.string().max(10),
          focusPattern: z.string().max(100).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const wordList = data.words.map((w) => `"${w.word}" (${w.definition})`).join(", ");

    const system = `You create mini-paragraph writing prompts for English learners. Given 2-3 target vocabulary words and definitions, generate a 1-2 sentence scenario prompt asking the learner to write a short 3-4 sentence paragraph connecting all these target words in a single coherent story or scenario.

Output ONLY valid JSON:
{
  "context": "..."
}`;

    const user = `Target Words: ${wordList}\nTarget Level: ${data.level}\n\nGenerate the mini-paragraph prompt now.`;
    const raw = await callAI(system, user);
    try {
      const parsed = parseJsonFromText<{ context: string }>(raw);
      return dailyContextResponseSchema.parse(parsed);
    } catch {
      const wordNames = data.words.map((w) => `"${w.word}"`).join(", ");
      return {
        context: `Write a short 3-4 sentence paragraph about a recent experience using all of these words: ${wordNames}.`,
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

export const evaluateFreeParagraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { words: string[]; context: string; learnerParagraph: string; level: string }) =>
      z
        .object({
          words: z.array(z.string().max(100)).min(2).max(5),
          context: z.string().max(500),
          learnerParagraph: z.string().min(1).max(1500),
          level: z.string().max(10),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const system = `You evaluate a language learner's mini-paragraph.
Target words to include: ${data.words.map((w) => `"${w}"`).join(", ")}.
Scenario prompt: "${data.context}".
Learner's paragraph: "${data.learnerParagraph}".
CEFR level: ${data.level}.

Tasks:
1. Check grammar across the paragraph.
2. Check whether each target word is used naturally according to its meaning.
3. Check paragraph cohesion (do sentences connect logically with appropriate connectors?).
4. Provide ONE short, constructive feedback paragraph (2-3 sentences) addressing the paragraph as a whole.
5. Provide an improved model version of the paragraph.

Output ONLY valid JSON:
{
  "grammaticallyCorrect": true|false,
  "naturalness": "natural" | "a bit awkward" | "not quite right",
  "feedback": "...",
  "improvedVersion": "..."
}`;

    const user = `Evaluate paragraph now.`;
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
        feedback: "Great paragraph! You connected all target words coherently.",
        improvedVersion: data.learnerParagraph,
      };
    }
  });
