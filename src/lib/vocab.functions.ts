import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseCard } from "./parse-card";

export interface FullLesson {
  explanation: string;
  pronunciationTips: string;
  registerVariants: { register: string; example: string }[];
  synonyms: { word: string; nuance: string }[];
  antonyms: { word: string; nuance: string }[];
  relatedIdioms: { phrase: string; meaning: string }[];
  commonMistakes: string[];
  collocations: string[];
  dialogue: { title: string; lines: { speaker: string; text: string }[] };
  readingPassage: string;
  speakingPrompts: string[];
  quiz: { question: string; options: string[]; correctIndex: number; explanation: string }[];
}

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const AI_MODEL = "google/gemini-2.5-flash";

const CARD_SYSTEM = `Tu es un générateur de fiches de vocabulaire anglais pour un apprenant francophone de niveau A2-B2. Quand on te donne un mot, une expression, ou une phrase en anglais, tu réponds UNIQUEMENT avec la fiche au format exact suivant, sans préambule ni markdown :

WORD
[le mot ou l'expression exacte]
LEVEL
[A1, A2, B1, B2, C1 ou C2]
IPA
[transcription phonétique entre / /]
PART OF SPEECH
[nature grammaticale]
DEFINITION (simple English)
[définition en anglais simple, 1-2 phrases]
FRENCH
[traduction en français]
GRAMMAR (how to use it)
Structure:
* [structure]
Used to:
* [usage 1]
* [usage 2]
Common forms:
* [variante 1]
* [variante 2]
* [variante 3]
EXAMPLES (2–3 sentences)
[3 phrases d'exemple]
CLOZE (1–3 sentences)
[3 phrases à trous avec ______ et → réponse]
SPEAKING (questions + answer)
Question: [question naturelle]
Answer: [réponse modèle]
Question: [deuxième question]
Answer: [deuxième réponse]
TAGS
[2 à 4 tags en français séparés par des virgules, choisis parmi ou inspirés de : Entretien, Quotidien, Tech, Voyage, Académique, Business, Émotion, Nature, Culture, Santé, Sport. Choisis les tags les plus pertinents pour le contexte d'usage du mot.]

Respecte cet ordre et ces en-têtes à la lettre près.`;

const LESSON_SYSTEM = `You are an experienced English teacher creating immersive learning content for a French-speaking learner motivated to improve fast in speaking and listening comprehension. You receive a word or expression with its CECRL level. Always aim slightly ABOVE the given level in your examples and reading passage (if B1, aim for B1+/B2), while keeping the explanations themselves clear and accessible. Respond ONLY with valid JSON, no text before or after, no markdown, following exactly this schema. Every single field must be written entirely in English — do not use any French anywhere in your response:

{
  "explanation": "3-4 sentences explaining the word's nuance, connotation (positive/neutral/negative), and register (formal/neutral/casual/slang)",
  "pronunciationTips": "concrete pronunciation guidance for a French speaker: stressed syllable, sounds that are hard for French speakers, typical intonation mistake",
  "registerVariants": [
    {"register": "formal", "example": "example sentence in a formal/professional context"},
    {"register": "neutral", "example": "example sentence in a neutral everyday context"},
    {"register": "casual", "example": "example sentence in a casual/friendly context"}
  ],
  "synonyms": [{"word": "...", "nuance": "subtle difference in meaning or register"}],
  "antonyms": [{"word": "...", "nuance": "..."}],
  "relatedIdioms": [{"phrase": "related idiomatic expression", "meaning": "meaning explained in English"}],
  "commonMistakes": ["common mistake a French speaker makes with this word, explained in English"],
  "collocations": ["natural, frequent word pairing"],
  "dialogue": {
    "title": "short title describing the dialogue context",
    "lines": [{"speaker": "A", "text": "..."}, {"speaker": "B", "text": "..."}]
  },
  "readingPassage": "rich narrative passage of 6-8 sentences, slightly above-level, using the target word naturally",
  "speakingPrompts": ["open-ended question encouraging a developed spoken answer using the target word"],
  "quiz": [{"question": "...", "options": ["...", "...", "..."], "correctIndex": 0, "explanation": "why this is correct, in English"}]
}

Generate: 3-4 synonyms, 2-3 antonyms, 2 relatedIdioms, 2-3 commonMistakes, 4-5 collocations, a natural 6-8 line alternating dialogue, a coherent readingPassage, 2 speakingPrompts, 2 quiz questions. Everything in English only, zero French.`;

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
  return json.choices?.[0]?.message?.content ?? "";
}

// ---------- Generate Card ----------
export const generateVocabCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { word: string; level?: string }) =>
    z.object({ word: z.string().trim().min(1).max(200), level: z.string().max(10).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const userMsg = data.level
      ? `Mot : ${data.word}\nNiveau visé : ${data.level}`
      : `Mot : ${data.word}`;
    const raw = await callAI(CARD_SYSTEM, userMsg);
    const parsed = parseCard(raw);
    if (!parsed.word) parsed.word = data.word;
    if (data.level && !parsed.level) parsed.level = data.level;

    const { data: inserted, error } = await supabase
      .from("cards")
      .insert({
        user_id: userId,
        word: parsed.word,
        ipa: parsed.ipa,
        pos: parsed.pos,
        level: parsed.level,
        definition: parsed.definition,
        french: parsed.french,
        grammar: parsed.grammar,
        examples: parsed.examples,
        cloze: parsed.cloze,
        speaking_q1: parsed.speaking_q1,
        speaking_a1: parsed.speaking_a1,
        speaking_q2: parsed.speaking_q2,
        speaking_a2: parsed.speaking_a2,
        tags: parsed.tags,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

// ---------- Generate Full Lesson ----------
export const generateFullLesson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string; force?: boolean }) =>
    z.object({ cardId: z.string().uuid(), force: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (!data.force) {
      const { data: existing } = await supabase
        .from("lessons")
        .select("content")
        .eq("card_id", data.cardId)
        .maybeSingle();
      if (existing) return existing.content as unknown as FullLesson;
    }

    const { data: card, error: cardErr } = await supabase
      .from("cards")
      .select("word, level")
      .eq("id", data.cardId)
      .single();
    if (cardErr || !card) throw new Error("Card not found");

    const userMsg = `Word: ${card.word}\nLevel: ${card.level || "B1"}`;

    const parseWithRetry = async (): Promise<FullLesson> => {
      const raw = await callAI(LESSON_SYSTEM, userMsg, true);
      try {
        return JSON.parse(raw);
      } catch {
        // retry once
        const raw2 = await callAI(LESSON_SYSTEM, userMsg + "\n\nReturn ONLY valid JSON.", true);
        return JSON.parse(raw2);
      }
    };
    const content = await parseWithRetry();

    // upsert (unique on card_id)
    const { error: upErr } = await supabase
      .from("lessons")
      .upsert(
        { user_id: userId, card_id: data.cardId, content: content as never },
        { onConflict: "card_id" },
      );
    if (upErr) throw new Error(upErr.message);
    return content;
  });

// ---------- Analyse Pronunciation Challenge ----------

const PRONUNCIATION_ANALYSIS_SYSTEM = `You are a linguistics expert and English pronunciation coach specialising in French-speaker challenges. Given an English word or expression, return a JSON object with EXACTLY these fields and NO other text:

{
  "ipa": "/phonetic transcription using IPA symbols/",
  "challengeCategory": "one of: th_sounds | vowels | english_r | h_sounds | w_vs_v | word_stress | consonant_cluster | other",
  "articulationTip": "1-2 concrete sentences explaining how to produce the hardest sound(s) correctly — physical placement of tongue/lips/jaw — written for a French speaker",
  "confusableAlternative": "the exact English word or short phrase a French speaker would most likely mispronounce this as, or null if no plausible confusable exists",
  "stressNote": "brief note on syllable stress pattern and rhythm if stress is a notable challenge for this word, or null if not applicable"
}

Rules:
- Respond ONLY with valid JSON, no markdown, no preamble.
- All text in English only.
- confusableAlternative MUST be null (not an empty string) when you are not confident of a real, linguistically plausible confusable pair.
- stressNote MUST be null for monosyllabic words or when stress is not a significant challenge.
- challengeCategory should reflect the PRIMARY phonetic challenge, not secondary ones.`;

export interface PronunciationAnalysis {
  ipa: string;
  challengeCategory: string;
  articulationTip: string;
  confusableAlternative: string | null;
  stressNote: string | null;
}

export const analyzePronunciationChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { wordOrPhrase: string }) =>
    z.object({ wordOrPhrase: z.string().trim().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<PronunciationAnalysis> => {
    const { supabase, userId } = context;
    const word = data.wordOrPhrase.trim();

    // --- Cache check ---
    const { data: cached } = await supabase
      .from("custom_pronunciation_items")
      .select("ipa, challenge_category, articulation_tip, confusable_alternative, stress_note")
      .eq("user_id", userId)
      .ilike("word_or_phrase", word)
      .maybeSingle();

    if (cached) {
      return {
        ipa: cached.ipa,
        challengeCategory: cached.challenge_category,
        articulationTip: cached.articulation_tip,
        confusableAlternative: cached.confusable_alternative,
        stressNote: cached.stress_note,
      };
    }

    // --- AI call ---
    const raw = await callAI(PRONUNCIATION_ANALYSIS_SYSTEM, `Word or expression: ${word}`, true);

    let analysis: PronunciationAnalysis;
    try {
      const parsed = JSON.parse(raw) as {
        ipa?: unknown;
        challengeCategory?: unknown;
        articulationTip?: unknown;
        confusableAlternative?: unknown;
        stressNote?: unknown;
      };

      // Validate shape — never trust raw AI output
      if (
        typeof parsed.ipa !== "string" ||
        typeof parsed.challengeCategory !== "string" ||
        typeof parsed.articulationTip !== "string"
      ) {
        throw new Error("AI returned invalid shape");
      }

      analysis = {
        ipa: parsed.ipa,
        challengeCategory: parsed.challengeCategory,
        articulationTip: parsed.articulationTip,
        confusableAlternative:
          typeof parsed.confusableAlternative === "string" &&
          parsed.confusableAlternative.length > 0
            ? parsed.confusableAlternative
            : null,
        stressNote:
          typeof parsed.stressNote === "string" && parsed.stressNote.length > 0
            ? parsed.stressNote
            : null,
      };
    } catch {
      throw new Error("Failed to parse pronunciation analysis from AI.");
    }

    // --- Persist (upsert on unique index) ---
    await supabase.from("custom_pronunciation_items").upsert(
      {
        user_id: userId,
        word_or_phrase: word,
        ipa: analysis.ipa,
        challenge_category: analysis.challengeCategory,
        articulation_tip: analysis.articulationTip,
        confusable_alternative: analysis.confusableAlternative,
        stress_note: analysis.stressNote,
      },
      { onConflict: "user_id,word_or_phrase" },
    );

    return analysis;
  });
