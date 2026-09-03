// Manual type definitions for new tables added by the learner_profile migration.
// The auto-generated types.ts won't include these until regenerated via the Supabase CLI.
// These types are used throughout the Fluency Coach feature with explicit casts.

export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

export function nextCefrLevel(level: CefrLevel): CefrLevel | null {
  const idx = CEFR_LEVELS.indexOf(level);
  return idx < CEFR_LEVELS.length - 1 ? CEFR_LEVELS[idx + 1] : null;
}

export interface LearnerProfile {
  id: string;
  user_id: string;
  current_level: CefrLevel;
  level_updated_at?: string;
  updated_at?: string;
  created_at: string;
}

export interface LearnerWeakPoint {
  id: string;
  user_id: string;
  tag: string;
  example: string;
  occurrences: number;
  last_seen_at: string;
  resolved: boolean;
  created_at: string;
}
