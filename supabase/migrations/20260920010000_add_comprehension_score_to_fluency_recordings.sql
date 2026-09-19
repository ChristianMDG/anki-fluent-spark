-- Add comprehension_score column to fluency_recordings for Listening Challenge completion tracking
ALTER TABLE public.fluency_recordings
  ADD COLUMN IF NOT EXISTS comprehension_score text DEFAULT NULL;
