-- Atomic increment for journey_cells.sessions_completed.
-- The client previously did a read-then-write
-- (`update({ sessions_completed: cell.sessions_completed + 1 })`), which is a
-- race condition: two concurrent session completions (double-click, two tabs,
-- retry after a slow network) can both read the same stale value and only
-- one increment sticks. This function increments in a single atomic
-- UPDATE ... SET sessions_completed = sessions_completed + 1 statement.

CREATE OR REPLACE FUNCTION public.increment_journey_cell_session(_cell_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  UPDATE public.journey_cells
  SET sessions_completed = sessions_completed + 1,
      updated_at = now()
  WHERE id = _cell_id AND user_id = auth.uid();
END; $$;

GRANT EXECUTE ON FUNCTION public.increment_journey_cell_session(uuid) TO authenticated;
