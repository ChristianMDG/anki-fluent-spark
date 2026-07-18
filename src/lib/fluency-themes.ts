export const FLUENCY_THEMES = [
  {
    key: "storytelling",
    title: "Everyday storytelling",
    description: "Talk about your day, your habits, little everyday stories.",
  },
  {
    key: "opinions",
    title: "Opinions & arguments",
    description: "Give a clear opinion and support it with concrete examples.",
  },
  {
    key: "hypothetical",
    title: "Hypothetical situations",
    description: "Practice the conditional: 'what would you do if...'.",
  },
  {
    key: "describing",
    title: "Describing people & places",
    description: "Make rich and vivid descriptions of people and places.",
  },
  {
    key: "past",
    title: "Past experiences & memories",
    description: "Tell a striking memory or personal experience in the past tense.",
  },
  {
    key: "future",
    title: "Future plans & aspirations",
    description: "Project yourself, talk about your objectives, future desires.",
  },
] as const;

export type FluencyTheme = (typeof FLUENCY_THEMES)[number];

// ISO week number
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function currentTheme(date: Date = new Date()): FluencyTheme {
  const idx = isoWeek(date) % FLUENCY_THEMES.length;
  return FLUENCY_THEMES[idx];
}

export type SessionLength = "quick" | "standard" | "deep";

export const SESSION_CONFIG: Record<
  SessionLength,
  { label: string; minutes: number; exerciseCount: number; freeTalkSeconds: number }
> = {
  quick: { label: "Quick", minutes: 3, exerciseCount: 1, freeTalkSeconds: 60 },
  standard: { label: "Standard", minutes: 7, exerciseCount: 2, freeTalkSeconds: 90 },
  deep: { label: "Deep", minutes: 15, exerciseCount: 3, freeTalkSeconds: 120 },
};
