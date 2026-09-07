import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

async function callAI(system: string, user: string, jsonMode = false): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const body: Record<string, unknown> = {
    model: AI_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (jsonMode) body.response_format = { type: "json_object" };

  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
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

// ---------------------------------------------------------------------------
// Gutenberg boilerplate stripping
// ---------------------------------------------------------------------------

function stripGutenbergBoilerplate(raw: string): string {
  const startMarkers = [
    "*** START OF THE PROJECT GUTENBERG EBOOK",
    "***START OF THE PROJECT GUTENBERG EBOOK",
    "*END*THE SMALL PRINT",
    "END THE SMALL PRINT",
  ];
  const endMarkers = [
    "*** END OF THE PROJECT GUTENBERG EBOOK",
    "***END OF THE PROJECT GUTENBERG EBOOK",
    "End of the Project Gutenberg EBook",
    "End of Project Gutenberg's",
  ];

  let start = -1;
  for (const marker of startMarkers) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) {
      // Skip to the end of the marker line
      const lineEnd = raw.indexOf("\n", idx);
      start = lineEnd !== -1 ? lineEnd + 1 : idx + marker.length;
      break;
    }
  }

  let end = raw.length;
  for (const marker of endMarkers) {
    const idx = raw.indexOf(marker);
    if (idx !== -1 && idx > 100) {
      end = idx;
      break;
    }
  }

  const text = start !== -1 ? raw.slice(start, end) : raw.slice(0, end);
  return text.trim();
}

// ---------------------------------------------------------------------------
// Text chunking — split on paragraph boundaries, ~2000 words per chunk
// ---------------------------------------------------------------------------

const TARGET_WORDS = 2000;
const MAX_WORDS = 2500;

function chunkText(text: string): string[] {
  // Split into paragraphs (blank-line separated)
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\r/g, "").replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const para of paragraphs) {
    const words = para.split(/\s+/).length;

    // If a single paragraph is already huge, force-add it as its own chunk
    if (words > MAX_WORDS) {
      if (current.length > 0) {
        chunks.push(current.join("\n\n"));
        current = [];
        currentWords = 0;
      }
      chunks.push(para);
      continue;
    }

    // If adding this paragraph would exceed MAX, flush current first
    if (currentWords + words > MAX_WORDS && currentWords >= TARGET_WORDS * 0.6) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }

    current.push(para);
    currentWords += words;

    // Flush when we hit target
    if (currentWords >= TARGET_WORDS) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n\n"));
  }

  return chunks.filter((c) => c.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Server function: fetchBookText
// Fetches a Gutenberg plain-text file (via server to avoid CORS), strips
// boilerplate, and returns paginated chunks.
// ---------------------------------------------------------------------------

export const fetchBookText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { bookId: number; textUrl: string }) =>
      z
        .object({
          bookId: z.number().int().positive(),
          textUrl: z.string().url().max(500),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    // Validate that the URL is a Project Gutenberg URL
    const url = new URL(data.textUrl);
    if (!url.hostname.endsWith("gutenberg.org") && !url.hostname.endsWith("gutenberg.net.au")) {
      throw new Error("Only Project Gutenberg URLs are allowed");
    }

    const res = await fetch(data.textUrl, {
      headers: { "User-Agent": "I-Speak-App/1.0 (educational, public-domain)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Failed to fetch book text: HTTP ${res.status}`);

    const raw = await res.text();
    const stripped = stripGutenbergBoilerplate(raw);
    const chunks = chunkText(stripped);

    if (chunks.length === 0) throw new Error("No readable text found in this book");

    return { chunks, totalChunks: chunks.length };
  });

// ---------------------------------------------------------------------------
// Server function: suggestBooksForLevel
// AI returns well-known PD title/author pairs; client then resolves each
// through Gutendex to get real metadata before displaying.
// ---------------------------------------------------------------------------

const SUGGEST_SYSTEM = `You are an expert English literature curator for language learners. Given a CEFR level and optional interests, output a JSON array of 8 well-known, genuinely accessible English-language public-domain books ideal for learners at that level.

Guidelines by level:
- A1/A2: Very short classics, fairy tales, simple adventure stories (e.g. simple Dickens abridged, fairy tales, fables). Short sentences, familiar vocabulary.
- B1: Accessible classics with clear plots (e.g. The Secret Garden, Treasure Island, Robinson Crusoe, Sherlock Holmes short stories).
- B2: Engaging 19th-century novels and classic fiction (e.g. Pride and Prejudice, Jane Eyre, The Picture of Dorian Gray, Frankenstein).
- C1/C2: Dense literary works (e.g. Moby Dick, Middlemarch, James Joyce, Henry James).

CRITICAL: Only suggest titles you are certain exist in the public domain and are on Project Gutenberg. Do NOT invent titles. Only use well-known, widely-recognized classic works.

Output ONLY a valid JSON array, no text before or after:
[{"title": "Exact Title As Known", "author": "Author Full Name"}, ...]`;

const suggestSchema = z.array(
  z.object({
    title: z.string().min(1).max(200),
    author: z.string().min(1).max(200),
  }),
);

export const suggestBooksForLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { level: string; interests?: string }) =>
      z
        .object({
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
          interests: z.string().max(200).optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const userMsg = `CEFR Level: ${data.level}${data.interests ? `\nLearner interests: ${data.interests}` : ""}\n\nSuggest 8 ideal public-domain books for this learner.`;
    const raw = await callAI(SUGGEST_SYSTEM, userMsg, true);

    let suggestions: { title: string; author: string }[] = [];
    try {
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const arrMatch = cleaned.match(/\[[\s\S]*\]/);
      if (!arrMatch) return { suggestions: [] };
      const parsed = JSON.parse(arrMatch[0]) as unknown;
      suggestions = suggestSchema.parse(parsed);
    } catch {
      return { suggestions: [] };
    }

    return { suggestions };
  });

// ---------------------------------------------------------------------------
// Server function: explainWordInContext
// Returns a brief definition and usage note for a word in context.
// Kept intentionally cheap/short for fast popover UX.
// ---------------------------------------------------------------------------

const EXPLAIN_SYSTEM = `You are a concise English vocabulary explainer for a language learner. Given a word and the sentence it appears in, output ONLY a valid JSON object:
{"definition": "1-sentence plain English definition", "usage": "1-sentence note on register or how it's typically used"}
No preamble, no markdown, no French. Everything in English. Be brief.`;

const explainSchema = z.object({
  definition: z.string().min(1).max(500),
  usage: z.string().min(1).max(500),
});

export const explainWordInContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { word: string; sentence: string; level: string }) =>
      z
        .object({
          word: z.string().min(1).max(100),
          sentence: z.string().min(1).max(1000),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const userMsg = `Word: "${data.word}"\nSentence: "${data.sentence}"\nLearner level: ${data.level}`;
    const raw = await callAI(EXPLAIN_SYSTEM, userMsg, true);

    try {
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      return explainSchema.parse(parsed);
    } catch {
      // Graceful fallback — never let a popover crash the reader
      return {
        definition: `"${data.word}" — definition unavailable. Try again.`,
        usage: "",
      };
    }
  });

// ---------------------------------------------------------------------------
// Server function: generateComprehensionCheck
// Returns 1–2 multiple-choice questions about the chunk just read.
// ---------------------------------------------------------------------------

export interface ComprehensionQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const COMPREHENSION_SYSTEM = `You are a reading comprehension tutor for English language learners. Given a passage of text and the learner's CEFR level, generate exactly 2 multiple-choice comprehension questions about the passage.

Rules:
- Questions must be answerable from the passage alone (no outside knowledge needed).
- Options: exactly 3 choices per question.
- Adapt vocabulary in questions/answers to the learner's level.
- Output ONLY valid JSON, no text before or after:

{"questions": [{"question": "...", "options": ["A", "B", "C"], "correctIndex": 0, "explanation": "Why this is correct, in simple English."}]}`;

const comprehensionSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(1).max(500),
        options: z.array(z.string().min(1).max(300)).min(2).max(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(2),
});

export const generateComprehensionCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { chunkText: string; level: string }) =>
      z
        .object({
          // Limit chunk sent to AI to avoid huge token bills — first 3000 chars is enough
          chunkText: z.string().min(50).max(6000),
          level: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const passage = data.chunkText.slice(0, 3000);
    const userMsg = `Learner level: ${data.level}\n\nPassage:\n${passage}\n\nGenerate 2 comprehension questions now.`;
    const raw = await callAI(COMPREHENSION_SYSTEM, userMsg, true);

    try {
      const cleaned = raw.replace(/```(?:json)?|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      const result = comprehensionSchema.parse(parsed);
      return result;
    } catch {
      return { questions: [] };
    }
  });

// ---------------------------------------------------------------------------
// Server function: searchGutendex
// Proxies search requests to gutendex.com server-side to avoid CORS issues
// ---------------------------------------------------------------------------

export interface GutendexBook {
  id: number;
  title: string;
  authors: { name: string; birth_year: number | null; death_year: number | null }[];
  subjects: string[];
  languages: string[];
  download_count: number;
  formats: Record<string, string>;
}

export interface GutendexResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
}

export const searchGutendex = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { query?: string; page?: number }) =>
      z
        .object({
          query: z.string().max(200).optional(),
          page: z.number().int().positive().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data }) => {
    const params = new URLSearchParams({
      languages: "en",
      page: String(data.page ?? 1),
    });
    if (data.query?.trim()) params.set("search", data.query.trim());

    const res = await fetch(`https://gutendex.com/books?${params.toString()}`, {
      headers: { "User-Agent": "I-Speak-App/1.0 (educational, public-domain)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Gutendex error: HTTP ${res.status}`);
    const json = (await res.json()) as GutendexResponse;
    return json;
  });

