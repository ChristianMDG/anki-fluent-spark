export const FLUENCY_THEMES = [
  {
    key: "storytelling",
    title: "Everyday storytelling",
    description: "Raconter sa journée, ses habitudes, les petites histoires du quotidien.",
  },
  {
    key: "opinions",
    title: "Opinions & arguments",
    description: "Donner un avis clair et le justifier avec des exemples concrets.",
  },
  {
    key: "hypothetical",
    title: "Hypothetical situations",
    description: "S'entraîner au conditionnel : « what would you do if… ».",
  },
  {
    key: "describing",
    title: "Describing people & places",
    description: "Faire des descriptions riches et vivantes de personnes et de lieux.",
  },
  {
    key: "past",
    title: "Past experiences & memories",
    description: "Raconter au passé un souvenir marquant, une expérience vécue.",
  },
  {
    key: "future",
    title: "Future plans & aspirations",
    description: "Se projeter, parler de ses objectifs, de ses envies futures.",
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
  quick: { label: "Rapide", minutes: 3, exerciseCount: 1, freeTalkSeconds: 60 },
  standard: { label: "Standard", minutes: 7, exerciseCount: 2, freeTalkSeconds: 90 },
  deep: { label: "Approfondi", minutes: 15, exerciseCount: 3, freeTalkSeconds: 120 },
};
