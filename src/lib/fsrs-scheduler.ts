import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card as FSRSCard,
  type FSRSParameters,
  type Grade,
} from "ts-fsrs";

export type AnkiGrade = "again" | "hard" | "good" | "easy";

export interface FSRSCardFields {
  fsrs_stability?: number | null;
  fsrs_difficulty?: number | null;
  fsrs_state?: "new" | "learning" | "review" | "relearning" | null;
  fsrs_step?: number | null;
  fsrs_last_review?: string | null;
  due_at?: string;
  // legacy SM-2 fields retained for fallback/rollback safety
  ease_factor?: number;
  interval_days?: number;
  repetitions?: number;
  card_state?: "new" | "learning" | "review" | "relearning";
  learning_step?: number;
}

export interface FSRSCalculationResult {
  fsrs_stability: number;
  fsrs_difficulty: number;
  fsrs_state: "new" | "learning" | "review" | "relearning";
  fsrs_step: number | null;
  fsrs_last_review: string;
  due_at: string;
  last_reviewed_at: string;
}

// Configured FSRS Parameters as specified
export const fsrsParams: FSRSParameters = generatorParameters({
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
});

export const scheduler = fsrs(fsrsParams);

/**
 * Map DB row fields to a ts-fsrs Card object.
 * Unreviewed / SM-2 legacy cards default to createEmptyCard().
 */
export function toFsrsCard(dbRow: FSRSCardFields, now: Date = new Date()): FSRSCard {
  if (
    dbRow.fsrs_stability !== undefined &&
    dbRow.fsrs_stability !== null &&
    dbRow.fsrs_difficulty !== undefined &&
    dbRow.fsrs_difficulty !== null &&
    dbRow.fsrs_state !== undefined &&
    dbRow.fsrs_state !== null
  ) {
    let stateEnum: State = State.New;
    switch (dbRow.fsrs_state) {
      case "new":
        stateEnum = State.New;
        break;
      case "learning":
        stateEnum = State.Learning;
        break;
      case "review":
        stateEnum = State.Review;
        break;
      case "relearning":
        stateEnum = State.Relearning;
        break;
    }

    return {
      due: dbRow.due_at ? new Date(dbRow.due_at) : now,
      stability: dbRow.fsrs_stability,
      difficulty: dbRow.fsrs_difficulty,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: dbRow.repetitions ?? 0,
      lapses: 0,
      learning_steps: dbRow.fsrs_step ?? 0,
      state: stateEnum,
      last_review: dbRow.fsrs_last_review ? new Date(dbRow.fsrs_last_review) : undefined,
    };
  }

  // Safe default: return an empty FSRS card for new cards or unmigrated legacy cards
  return createEmptyCard(now);
}

/**
 * Map a ts-fsrs Card result back into DB column fields to persist.
 */
export function fromFsrsCard(fsrsCard: FSRSCard, now: Date = new Date()): FSRSCalculationResult {
  const stateMap: Record<State, "new" | "learning" | "review" | "relearning"> = {
    [State.New]: "new",
    [State.Learning]: "learning",
    [State.Review]: "review",
    [State.Relearning]: "relearning",
  };

  const isStepState = fsrsCard.state === State.Learning || fsrsCard.state === State.Relearning;

  return {
    fsrs_stability: Math.round(fsrsCard.stability * 10000) / 10000,
    fsrs_difficulty: Math.round(fsrsCard.difficulty * 10000) / 10000,
    fsrs_state: stateMap[fsrsCard.state] ?? "new",
    fsrs_step: isStepState ? fsrsCard.learning_steps : null,
    fsrs_last_review: fsrsCard.last_review ? fsrsCard.last_review.toISOString() : now.toISOString(),
    due_at: fsrsCard.due.toISOString(),
    last_reviewed_at: now.toISOString(),
  };
}

const ratingMap: Record<AnkiGrade, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/**
 * Main card grading entry point: returns updated FSRS database fields.
 */
export function gradeCard(
  dbRow: FSRSCardFields,
  grade: AnkiGrade,
  now: Date = new Date(),
): FSRSCalculationResult {
  const rating = ratingMap[grade];
  const fsrsCard = toFsrsCard(dbRow, now);
  const result = scheduler.next(fsrsCard, now, rating);
  return fromFsrsCard(result.card, now);
}

/**
 * Format timestamp difference into user-friendly delay string (e.g. "<1m", "10m", "1d", "4d").
 */
export function formatDelayLabel(dueAt: string, now: Date = new Date()): string {
  const due = new Date(dueAt).getTime();
  const diffMs = due - now.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 60) return "<1m";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;

  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;

  if (diffDays < 365) {
    const months = Math.round(diffDays / 30);
    return `${months}mo`;
  }

  const years = Math.round(diffDays / 365);
  return `${years}y`;
}

/**
 * Compute preview delay strings for all 4 grade buttons at once.
 */
export function previewFsrsGrades(
  dbRow: FSRSCardFields,
  now: Date = new Date(),
): Record<AnkiGrade, string> {
  const fsrsCard = toFsrsCard(dbRow, now);
  const repeatResults = scheduler.repeat(fsrsCard, now);

  return {
    again: formatDelayLabel(repeatResults[Rating.Again].card.due.toISOString(), now),
    hard: formatDelayLabel(repeatResults[Rating.Hard].card.due.toISOString(), now),
    good: formatDelayLabel(repeatResults[Rating.Good].card.due.toISOString(), now),
    easy: formatDelayLabel(repeatResults[Rating.Easy].card.due.toISOString(), now),
  };
}

/**
 * Backwards compatible preview function.
 */
export function previewIntervalLabel(
  card: FSRSCardFields,
  grade: AnkiGrade,
  now: Date = new Date(),
): string {
  const res = gradeCard(card, grade, now);
  return formatDelayLabel(res.due_at, now);
}
