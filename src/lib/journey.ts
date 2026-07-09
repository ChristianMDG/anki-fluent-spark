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
    label: "Transactionnel",
    icon: "🛒",
    description: "Boutiques, restaurants, voyage, démarches concrètes du quotidien.",
  },
  professional: {
    label: "Professionnel",
    icon: "💼",
    description:
      "Réunions, échanges entre collègues, discussions au travail (hors entretien).",
  },
  emotional: {
    label: "Émotionnel",
    icon: "💗",
    description: "Parler d'émotions, soutenir, gérer un désaccord, être empathique.",
  },
  narrative: {
    label: "Narratif / créatif",
    icon: "📖",
    description: "Raconter une anecdote, une scène imaginaire, un souvenir marquant.",
  },
};

export const COMPLEXITY_META: Record<
  number,
  { label: string; description: string }
> = {
  1: { label: "Décrire", description: "Décrire objets, personnes, routines au présent." },
  2: { label: "Raconter", description: "Enchaîner un récit au passé, avec connecteurs." },
  3: { label: "Argumenter", description: "Donner un avis et le justifier avec des exemples." },
  4: { label: "Hypothèses", description: "Utiliser les conditionnels et se projeter." },
  5: { label: "Nuance", description: "Nuancer, moduler le ton, jouer sur les registres." },
};

export type JourneyStatus = "locked" | "available" | "in_progress" | "mastered";
