export const JOURNEY_SITUATIONS = [
  "social",
  "transactional",
  "professional",
  "emotional",
  "narrative",
] as const;
export type JourneySituation = (typeof JOURNEY_SITUATIONS)[number];

export const SITUATION_META: Record<
  JourneySituation,
  { label: string; icon: string; description: string }
> = {
  social: {
    label: "Social",
    icon: "☕",
    description: "Small talk, meeting people, casual social interactions.",
  },
  transactional: {
    label: "Transactional",
    icon: "🛒",
    description: "Shops, restaurants, travel, concrete daily tasks.",
  },
  professional: {
    label: "Professional",
    icon: "💼",
    description:
      "Meetings, peer interactions, workplace discussions (excluding interviews).",
  },
  emotional: {
    label: "Emotional",
    icon: "💗",
    description: "Discussing emotions, offering support, managing conflict, showing empathy.",
  },
  narrative: {
    label: "Narrative / Creative",
    icon: "📖",
    description: "Telling an anecdote, an imaginary scene, a striking memory.",
  },
};

export const COMPLEXITY_META: Record<
  number,
  { label: string; description: string }
> = {
  1: { label: "Describe", description: "Describe objects, people, routines in the present tense." },
  2: { label: "Narrate", description: "String together a past narrative with linking words." },
  3: { label: "Argue", description: "Express an opinion and support it with examples." },
  4: { label: "Hypothesize", description: "Use conditionals and project scenarios." },
  5: { label: "Nuance", description: "Nuance ideas, modulate tone, play on different registers." },
};

export type JourneyStatus = "locked" | "available" | "in_progress" | "mastered";
