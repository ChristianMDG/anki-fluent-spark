CREATE TABLE public.custom_pronunciation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word_or_phrase text NOT NULL,
  ipa text NOT NULL,
  challenge_category text NOT NULL,
  articulation_tip text NOT NULL,
  confusable_alternative text,
  stress_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_pronunciation_items_user_word_idx
  ON public.custom_pronunciation_items (user_id, word_or_phrase);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_pronunciation_items TO authenticated;
GRANT ALL ON public.custom_pronunciation_items TO service_role;

ALTER TABLE public.custom_pronunciation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pronunciation items"
ON public.custom_pronunciation_items
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);