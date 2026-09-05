/**
 * Pure SM-2 Spaced Repetition Algorithm Implementation
 * Standard Anki-style mapping:
 * 0 = Again
 * 3 = Hard
 * 4 = Good
 * 5 = Easy
 */

export type SM2Grade = 0 | 3 | 4 | 5;

export interface CardSM2State {
  ease_factor: number; // default 2.5
  interval_days: number; // default 0
  repetitions: number; // default 0
}

export interface SM2CalculationResult {
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_at: string;
}

/**
 * Calculates the next SM-2 state for a card given its current state and grade.
 * @param card Current card SM-2 metrics
 * @param grade Performance rating (0: Again, 3: Hard, 4: Good, 5: Easy)
 * @param now Reference timestamp (defaults to current Date)
 */
export function calculateSM2(
  card: CardSM2State,
  grade: SM2Grade,
  now: Date = new Date(),
): SM2CalculationResult {
  let { ease_factor = 2.5, interval_days = 0, repetitions = 0 } = card;

  if (grade < 3) {
    // Failure / Again
    repetitions = 0;
    interval_days = 1;
  } else {
    // Success / Hard, Good, Easy
    if (repetitions === 0) {
      interval_days = 1;
    } else if (repetitions === 1) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    repetitions += 1;
  }

  // Update Ease Factor
  ease_factor = ease_factor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  ease_factor = Math.max(1.3, ease_factor);

  // Round ease_factor to 2 decimal places to prevent floating point noise
  ease_factor = Math.round(ease_factor * 100) / 100;

  // Calculate due_at timestamp
  const dueTimestamp = new Date(now.getTime() + interval_days * 24 * 60 * 60 * 1000);

  return {
    ease_factor,
    interval_days,
    repetitions,
    due_at: dueTimestamp.toISOString(),
  };
}

/**
 * Format interval days to user-friendly label (e.g. "1d", "6d", "12d", "1m").
 */
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

/**
 * Helper to preview the resulting next interval label for a given grade
 */
export function previewIntervalLabel(card: CardSM2State, grade: SM2Grade): string {
  const result = calculateSM2(card, grade);
  return formatInterval(result.interval_days);
}

/**
 * Sanity checks for SM-2 logic verification.
 * Throws an error if any invariant fails.
 */
export function runSM2SanityChecks(): { passed: boolean; logs: string[] } {
  const logs: string[] = [];

  // Check 1: Fresh card graded "Again" stays due in 1 day with reset repetitions
  const freshCard: CardSM2State = { ease_factor: 2.5, interval_days: 0, repetitions: 0 };
  const resAgain = calculateSM2(freshCard, 0);
  if (resAgain.repetitions !== 0 || resAgain.interval_days !== 1) {
    throw new Error(`Sanity Check 1 Failed: Fresh card Again returned ${JSON.stringify(resAgain)}`);
  }
  logs.push(`Check 1 Passed: Fresh card Again -> interval=${resAgain.interval_days}d, reps=${resAgain.repetitions}, ease=${resAgain.ease_factor}`);

  // Check 2: Sequential "Good" grades grow interval (1 -> 6 -> 15d)
  const step1 = calculateSM2(freshCard, 4); // reps=0 -> interval=1, reps becomes 1
  if (step1.interval_days !== 1 || step1.repetitions !== 1) {
    throw new Error(`Sanity Check 2a Failed: ${JSON.stringify(step1)}`);
  }
  const step2 = calculateSM2(step1, 4); // reps=1 -> interval=6, reps becomes 2
  if (step2.interval_days !== 6 || step2.repetitions !== 2) {
    throw new Error(`Sanity Check 2b Failed: ${JSON.stringify(step2)}`);
  }
  const step3 = calculateSM2(step2, 4); // reps=2 -> Math.round(6 * 2.5) = 15, reps becomes 3
  if (step3.interval_days !== 15 || step3.repetitions !== 3) {
    throw new Error(`Sanity Check 2c Failed: ${JSON.stringify(step3)}`);
  }
  logs.push(`Check 2 Passed: Good progression -> intervals: 1d -> ${step2.interval_days}d -> ${step3.interval_days}d`);

  // Check 3: Ease factor floor is 1.3
  let lowEaseCard: CardSM2State = { ease_factor: 1.4, interval_days: 1, repetitions: 1 };
  for (let i = 0; i < 5; i++) {
    lowEaseCard = calculateSM2(lowEaseCard, 0); // Repeated Again degrades ease factor
  }
  if (lowEaseCard.ease_factor < 1.3) {
    throw new Error(`Sanity Check 3 Failed: Ease factor dropped below 1.3 (${lowEaseCard.ease_factor})`);
  }
  logs.push(`Check 3 Passed: Ease factor floor enforced at ${lowEaseCard.ease_factor}`);

  return { passed: true, logs };
}
