/**
 * Pure Anki-faithful Spaced Repetition Algorithm Implementation
 * Replicates Anki's learning steps, relearning lapses, and interval multipliers.
 */

export type CardState = "new" | "learning" | "review" | "relearning";
export type AnkiGrade = "again" | "hard" | "good" | "easy";
export type SM2Grade = 0 | 3 | 4 | 5; // Backwards compatibility for numeric grades

export interface CardSRSMetrics {
  card_state?: CardState;
  learning_step?: number;
  ease_factor?: number;
  interval_days?: number;
  repetitions?: number;
}

export interface SRSCalculationResult {
  card_state: CardState;
  learning_step: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
}

// Anki Default Constants
export const LEARNING_STEPS_MINUTES = [1, 10];
export const RELEARNING_STEPS_MINUTES = [10];
export const GRADUATING_INTERVAL_DAYS = 1;
export const EASY_GRADUATING_INTERVAL_DAYS = 4;
export const HARD_INTERVAL_MULTIPLIER = 1.2;
export const EASY_BONUS_MULTIPLIER = 1.3;
export const LAPSE_EASE_PENALTY = 0.2;
export const MIN_EASE_FACTOR = 1.3;

export function normalizeGrade(grade: AnkiGrade | SM2Grade): AnkiGrade {
  if (typeof grade === "number") {
    switch (grade) {
      case 0:
        return "again";
      case 3:
        return "hard";
      case 4:
        return "good";
      case 5:
        return "easy";
      default:
        return "again";
    }
  }
  return grade;
}

/**
 * Pure function scheduling a card according to Anki's state machine.
 */
export function scheduleCard(
  card: CardSRSMetrics,
  rawGrade: AnkiGrade | SM2Grade,
  now: Date = new Date(),
): SRSCalculationResult {
  const grade = normalizeGrade(rawGrade);

  let state: CardState = card.card_state ?? "new";
  let step = card.learning_step ?? 0;
  let ease = card.ease_factor ?? 2.5;
  let interval = card.interval_days ?? 0;
  let reps = card.repetitions ?? 0;

  let dueMs = now.getTime();

  // Helper for adding minutes / days
  const addMinutes = (mins: number) => now.getTime() + mins * 60 * 1000;
  const addDays = (days: number) => now.getTime() + days * 24 * 60 * 60 * 1000;

  switch (state) {
    case "new":
    case "learning": {
      switch (grade) {
        case "again": {
          state = "learning";
          step = 0;
          dueMs = addMinutes(LEARNING_STEPS_MINUTES[0]);
          break;
        }
        case "hard": {
          state = "learning";
          // Stay at current step, delay by step minutes * 1.5
          const currentStepMin = LEARNING_STEPS_MINUTES[step] ?? LEARNING_STEPS_MINUTES[0];
          const delayMin = Math.round(currentStepMin * 1.5);
          dueMs = addMinutes(delayMin);
          break;
        }
        case "good": {
          const nextStep = step + 1;
          if (nextStep >= LEARNING_STEPS_MINUTES.length) {
            // Graduate to review
            state = "review";
            step = 0;
            interval = GRADUATING_INTERVAL_DAYS;
            reps = 1;
            dueMs = addDays(interval);
          } else {
            state = "learning";
            step = nextStep;
            dueMs = addMinutes(LEARNING_STEPS_MINUTES[nextStep]);
          }
          break;
        }
        case "easy": {
          // Graduate immediately with easy bonus
          state = "review";
          step = 0;
          interval = EASY_GRADUATING_INTERVAL_DAYS;
          reps = 1;
          dueMs = addDays(interval);
          break;
        }
      }
      break;
    }

    case "review": {
      switch (grade) {
        case "again": {
          // Lapse into relearning
          state = "relearning";
          step = 0;
          ease = Math.max(MIN_EASE_FACTOR, ease - LAPSE_EASE_PENALTY);
          dueMs = addMinutes(RELEARNING_STEPS_MINUTES[0]);
          // Note: interval and reps are kept per Anki lapse spec
          break;
        }
        case "hard": {
          state = "review";
          interval = Math.max(1, Math.round(interval * HARD_INTERVAL_MULTIPLIER));
          ease = Math.max(MIN_EASE_FACTOR, ease - 0.15);
          reps += 1;
          dueMs = addDays(interval);
          break;
        }
        case "good": {
          state = "review";
          interval = Math.max(1, Math.round(interval * ease));
          reps += 1;
          dueMs = addDays(interval);
          break;
        }
        case "easy": {
          state = "review";
          interval = Math.max(1, Math.round(interval * ease * EASY_BONUS_MULTIPLIER));
          ease += 0.15;
          reps += 1;
          dueMs = addDays(interval);
          break;
        }
      }
      break;
    }

    case "relearning": {
      switch (grade) {
        case "again": {
          state = "relearning";
          step = 0;
          dueMs = addMinutes(RELEARNING_STEPS_MINUTES[0]);
          break;
        }
        case "hard": {
          state = "relearning";
          const currentStepMin = RELEARNING_STEPS_MINUTES[step] ?? RELEARNING_STEPS_MINUTES[0];
          const delayMin = Math.round(currentStepMin * 1.5);
          dueMs = addMinutes(delayMin);
          break;
        }
        case "good": {
          const nextStep = step + 1;
          if (nextStep >= RELEARNING_STEPS_MINUTES.length) {
            // Graduate back to review
            state = "review";
            step = 0;
            interval = 1; // Restart interval near-zero per Anki lapse default
            dueMs = addDays(interval);
          } else {
            state = "relearning";
            step = nextStep;
            dueMs = addMinutes(RELEARNING_STEPS_MINUTES[nextStep]);
          }
          break;
        }
        case "easy": {
          state = "review";
          step = 0;
          interval = 1;
          dueMs = addDays(interval);
          break;
        }
      }
      break;
    }
  }

  // Round ease_factor to 2 decimal places
  ease = Math.round(ease * 100) / 100;

  return {
    card_state: state,
    learning_step: step,
    ease_factor: ease,
    interval_days: interval,
    repetitions: reps,
    due_at: new Date(dueMs).toISOString(),
  };
}

/**
 * Backwards compatible calculateSM2 function wrapping scheduleCard.
 */
export function calculateSM2(
  card: CardSRSMetrics,
  grade: SM2Grade | AnkiGrade,
  now: Date = new Date(),
): SRSCalculationResult {
  return scheduleCard(card, grade, now);
}

/**
 * Format timestamp difference into user-friendly delay string (e.g. "1m", "10m", "1d", "4d").
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
  return `${diffDays}d`;
}

export function formatInterval(days: number): string {
  if (days <= 0) return "<1d";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months}mo`;
  }
  const years = Math.round(days / 365);
  return `${years}y`;
}

export function previewIntervalLabel(
  card: CardSRSMetrics,
  grade: AnkiGrade | SM2Grade,
  now: Date = new Date(),
): string {
  const res = scheduleCard(card, grade, now);
  return formatDelayLabel(res.due_at, now);
}

/**
 * Comprehensive sanity tests covering state machine transitions.
 */
export function runSM2SanityChecks(): { passed: boolean; logs: string[] } {
  const logs: string[] = [];

  // Test 1: New card graded Again -> learning step 0, due in 1m
  const newCard: CardSRSMetrics = { card_state: "new", learning_step: 0, ease_factor: 2.5, interval_days: 0, repetitions: 0 };
  const resAgain = scheduleCard(newCard, "again");
  if (resAgain.card_state !== "learning" || resAgain.learning_step !== 0) {
    throw new Error(`Test 1 Failed: ${JSON.stringify(resAgain)}`);
  }
  logs.push(`Test 1 Passed: New + Again -> state=learning, step=0`);

  // Test 2: Learning card step 0 + Good -> learning step 1 (10m)
  const resGood1 = scheduleCard(resAgain, "good");
  if (resGood1.card_state !== "learning" || resGood1.learning_step !== 1) {
    throw new Error(`Test 2 Failed: ${JSON.stringify(resGood1)}`);
  }
  logs.push(`Test 2 Passed: Learning step 0 + Good -> state=learning, step=1`);

  // Test 3: Learning card step 1 + Good -> graduate to review (1d)
  const resGood2 = scheduleCard(resGood1, "good");
  if (resGood2.card_state !== "review" || resGood2.interval_days !== 1 || resGood2.repetitions !== 1) {
    throw new Error(`Test 3 Failed: ${JSON.stringify(resGood2)}`);
  }
  logs.push(`Test 3 Passed: Learning step 1 + Good -> graduated to review, interval=1d`);

  // Test 4: New card + Easy -> immediate graduation (4d)
  const resEasy = scheduleCard(newCard, "easy");
  if (resEasy.card_state !== "review" || resEasy.interval_days !== 4) {
    throw new Error(`Test 4 Failed: ${JSON.stringify(resEasy)}`);
  }
  logs.push(`Test 4 Passed: New + Easy -> graduated to review immediately, interval=4d`);

  // Test 5: Review card + Again -> lapse to relearning, ease penalty 0.20
  const reviewCard: CardSRSMetrics = { card_state: "review", learning_step: 0, ease_factor: 2.5, interval_days: 10, repetitions: 3 };
  const resLapse = scheduleCard(reviewCard, "again");
  if (resLapse.card_state !== "relearning" || resLapse.ease_factor !== 2.3) {
    throw new Error(`Test 5 Failed: ${JSON.stringify(resLapse)}`);
  }
  logs.push(`Test 5 Passed: Review + Again -> lapse to relearning, ease penalty applied (2.5 -> 2.3)`);

  // Test 6: Relearning card + Good -> graduate back to review with interval 1d
  const resRelGood = scheduleCard(resLapse, "good");
  if (resRelGood.card_state !== "review" || resRelGood.interval_days !== 1) {
    throw new Error(`Test 6 Failed: ${JSON.stringify(resRelGood)}`);
  }
  logs.push(`Test 6 Passed: Relearning + Good -> graduated back to review, interval=1d`);

  return { passed: true, logs };
}
