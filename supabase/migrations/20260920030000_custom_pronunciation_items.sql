-- Table for user-submitted custom pronunciation practice words
-- AI analysis results are cached here to avoid redundant calls.
CREATE TABLE IF NOT EXISTS public.custom_pronunciation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_or_phrase text NOT NULL,
  ipa text NOT NULL,
  challenge_category text NOT NULL,
  confusable_alternative text,
  articulation_tip text NOT NULL,
  stress_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per user + word so the same word is never analysed twice
CREATE UNIQUE INDEX IF NOT EXISTS custom_pronunciation_items_user_word_idx
  ON public.custom_pronunciation_items(user_id, lower(word_or_phrase));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pronunciation_items TO authenticated;
GRANT ALL ON public.custom_pronunciation_items TO service_role;

ALTER TABLE public.custom_pronunciation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_pronunciation_items_owner_all"
  ON public.custom_pronunciation_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
