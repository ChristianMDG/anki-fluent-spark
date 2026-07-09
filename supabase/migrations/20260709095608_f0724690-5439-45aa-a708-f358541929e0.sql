
-- ensure_journey_cells: runs as caller; user has INSERT policy on own rows
CREATE OR REPLACE FUNCTION public.ensure_journey_cells(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  sit public.journey_situation;
  lvl int;
BEGIN
  IF _user IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
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

-- recompute_journey_status: only trigger should call it
REVOKE EXECUTE ON FUNCTION public.recompute_journey_status(uuid) FROM PUBLIC, anon, authenticated;

-- trigger wrapper: SECURITY DEFINER so it can call recompute regardless of caller privileges
CREATE OR REPLACE FUNCTION public.journey_cells_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sessions_completed IS DISTINCT FROM OLD.sessions_completed THEN
    PERFORM public.recompute_journey_status(NEW.user_id);
  END IF;
  RETURN NEW;
END; $$;

-- prevent direct calls to the trigger function
REVOKE EXECUTE ON FUNCTION public.journey_cells_after_update() FROM PUBLIC, anon, authenticated;
