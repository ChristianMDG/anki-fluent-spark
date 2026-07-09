
DO $$ BEGIN
  CREATE TYPE public.journey_situation AS ENUM ('social','transactional','professional','emotional','narrative');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.journey_status AS ENUM ('locked','available','in_progress','mastered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.journey_cells (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  situation public.journey_situation NOT NULL,
  complexity_level int NOT NULL CHECK (complexity_level BETWEEN 1 AND 5),
  sessions_completed int NOT NULL DEFAULT 0,
  status public.journey_status NOT NULL DEFAULT 'locked',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, situation, complexity_level)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journey_cells TO authenticated;
GRANT ALL ON public.journey_cells TO service_role;

ALTER TABLE public.journey_cells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own journey cells" ON public.journey_cells
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.fluency_sessions
  ADD COLUMN IF NOT EXISTS journey_cell_id uuid REFERENCES public.journey_cells(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.ensure_journey_cells(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sit public.journey_situation;
  lvl int;
BEGIN
  FOREACH sit IN ARRAY ARRAY['social','transactional','professional','emotional','narrative']::public.journey_situation[] LOOP
    FOR lvl IN 1..5 LOOP
      INSERT INTO public.journey_cells(user_id, situation, complexity_level, status)
      VALUES (_user, sit, lvl,
        CASE WHEN sit = 'social' AND lvl = 1 THEN 'available'::public.journey_status
             ELSE 'locked'::public.journey_status END)
      ON CONFLICT (user_id, situation, complexity_level) DO NOTHING;
    END LOOP;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.ensure_journey_cells(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.recompute_journey_status(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  situations public.journey_situation[] := ARRAY['social','transactional','professional','emotional','narrative']::public.journey_situation[];
  sit public.journey_situation;
  prev_sit public.journey_situation;
  lvl int;
  i int;
  left_ok boolean;
  up_ok boolean;
  cur_status public.journey_status;
  cur_sessions int;
BEGIN
  FOR i IN 1..array_length(situations,1) LOOP
    sit := situations[i];
    FOR lvl IN 1..5 LOOP
      SELECT status, sessions_completed INTO cur_status, cur_sessions
        FROM public.journey_cells WHERE user_id = _user AND situation = sit AND complexity_level = lvl;

      IF cur_status IS NULL THEN CONTINUE; END IF;

      IF cur_sessions >= 5 THEN
        UPDATE public.journey_cells SET status = 'mastered', updated_at = now()
          WHERE user_id = _user AND situation = sit AND complexity_level = lvl AND status <> 'mastered';
        CONTINUE;
      END IF;

      IF lvl = 1 THEN
        left_ok := true;
      ELSE
        SELECT (status = 'mastered') INTO left_ok FROM public.journey_cells
          WHERE user_id = _user AND situation = sit AND complexity_level = lvl - 1;
        left_ok := COALESCE(left_ok, false);
      END IF;

      IF i = 1 THEN
        up_ok := true;
      ELSE
        prev_sit := situations[i-1];
        SELECT (status = 'mastered') INTO up_ok FROM public.journey_cells
          WHERE user_id = _user AND situation = prev_sit AND complexity_level = lvl;
        up_ok := COALESCE(up_ok, false);
      END IF;

      IF cur_sessions >= 1 AND left_ok AND up_ok THEN
        UPDATE public.journey_cells SET status = 'in_progress', updated_at = now()
          WHERE user_id = _user AND situation = sit AND complexity_level = lvl AND status <> 'in_progress';
      ELSIF left_ok AND up_ok THEN
        UPDATE public.journey_cells SET status = 'available', updated_at = now()
          WHERE user_id = _user AND situation = sit AND complexity_level = lvl AND status = 'locked';
      END IF;
    END LOOP;
  END LOOP;
END; $$;

GRANT EXECUTE ON FUNCTION public.recompute_journey_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.journey_cells_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sessions_completed IS DISTINCT FROM OLD.sessions_completed THEN
    PERFORM public.recompute_journey_status(NEW.user_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS journey_cells_recompute ON public.journey_cells;
CREATE TRIGGER journey_cells_recompute
AFTER UPDATE ON public.journey_cells
FOR EACH ROW EXECUTE FUNCTION public.journey_cells_after_update();
