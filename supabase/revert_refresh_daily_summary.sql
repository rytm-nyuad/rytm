-- ============================================================
-- REVERT: Restore refresh_daily_summary to original working version
-- Run this in Supabase SQL Editor immediately
-- Created: 2026-02-18
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_daily_summary(
  p_user_id UUID,
  p_target_date DATE DEFAULT NULL
)
RETURNS public.daily_summary
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz TEXT;
  client_ts TIMESTAMPTZ;
  client_day DATE;
  is_backlogged BOOLEAN := FALSE;
  local_date DATE;
  start_utc TIMESTAMPTZ;
  end_utc   TIMESTAMPTZ;

  v_has_overall BOOLEAN;
  v_has_meal BOOLEAN;
  v_has_water BOOLEAN;
  v_has_journal BOOLEAN;
  v_has_checkin BOOLEAN;
  v_is_complete BOOLEAN;

  y_streak INTEGER;
  v_streak INTEGER;

  GRACE_DAYS CONSTANT INTEGER := 1;
  today_local DATE;
  grace_start DATE;
  existing_streak INTEGER;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT fp.user_timezone INTO tz
    FROM public.fitbit_profile fp
    WHERE fp.app_user_id = p_user_id
    LIMIT 1;

  IF tz IS NULL OR length(trim(tz)) = 0 THEN
    tz := public.get_profile_timezone(p_user_id);
  END IF;

  IF tz IS NULL OR length(trim(tz)) = 0 THEN
    tz := 'UTC';
  END IF;

  IF p_target_date IS NULL THEN
    local_date := (now() AT TIME ZONE tz)::date;
  ELSE
    local_date := p_target_date;
  END IF;

  client_ts := now();
  client_day := ((client_ts AT TIME ZONE tz) - INTERVAL '4 hours')::date;
  IF client_day <> local_date THEN
    is_backlogged := TRUE;
  END IF;

  today_local := (now() AT TIME ZONE tz)::date;
  grace_start := today_local - GRACE_DAYS;

  start_utc := (local_date::timestamp AT TIME ZONE tz);
  end_utc   := ((local_date + 1)::timestamp AT TIME ZONE tz);

  SELECT EXISTS (
    SELECT 1 FROM public.daily_overall o
    WHERE o.user_id = p_user_id AND o.date = local_date
  ) INTO v_has_overall;

  SELECT EXISTS (
    SELECT 1 FROM public.meal_logs m
    WHERE m.user_id = p_user_id
      AND m.meal_datetime >= start_utc
      AND m.meal_datetime < end_utc
  ) INTO v_has_meal;

  SELECT EXISTS (
    SELECT 1 FROM public.water_intake_logs w
    WHERE w.user_id = p_user_id
      AND w.intake_datetime >= start_utc
      AND w.intake_datetime < end_utc
  ) INTO v_has_water;

  SELECT EXISTS (
    SELECT 1 FROM public.journal_messages j
    WHERE j.user_id = p_user_id
      AND j.created_at >= start_utc
      AND j.created_at < end_utc
  ) INTO v_has_journal;

  SELECT EXISTS (
    SELECT 1 FROM public.daily_checkins c
    WHERE c.user_id = p_user_id
      AND c.created_at >= start_utc
      AND c.created_at < end_utc
      AND c.sleep_quality IS NOT NULL
      AND c.energy_score IS NOT NULL
      AND c.focus_score IS NOT NULL
      AND c.workload_score IS NOT NULL
      AND c.coping_capacity_score IS NOT NULL
      AND c.stress_score IS NOT NULL
      AND c.stress_unexpected_score IS NOT NULL
      AND c.social_score IS NOT NULL
      AND c.mood_score IS NOT NULL
      AND c.mood_stability_score IS NOT NULL
      AND c.mood_emotions IS NOT NULL
      AND array_length(c.mood_emotions, 1) > 0
  ) INTO v_has_checkin;

  v_is_complete := v_has_overall AND v_has_meal AND v_has_journal AND v_has_checkin;

  IF local_date < grace_start THEN
    SELECT ds.streak_value INTO existing_streak
      FROM public.daily_summary ds
      WHERE ds.user_id = p_user_id AND ds.date = local_date
      LIMIT 1;

    v_streak := COALESCE(existing_streak, 0);

    INSERT INTO public.daily_summary (
      user_id, date, timezone,
      has_overall, has_meal, has_water, has_journal, has_checkin,
      is_complete, streak_value, updated_at
    )
    VALUES (
      p_user_id, local_date, tz,
      v_has_overall, v_has_meal, v_has_water, v_has_journal, v_has_checkin,
      v_is_complete, v_streak, now()
    )
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      timezone = EXCLUDED.timezone,
      has_overall = EXCLUDED.has_overall,
      has_meal = EXCLUDED.has_meal,
      has_water = EXCLUDED.has_water,
      has_journal = EXCLUDED.has_journal,
      has_checkin = EXCLUDED.has_checkin,
      is_complete = EXCLUDED.is_complete,
      updated_at = EXCLUDED.updated_at;

  ELSE
    IF v_is_complete THEN
      SELECT ds.streak_value INTO y_streak
        FROM public.daily_summary ds
        WHERE ds.user_id = p_user_id
          AND ds.date = (local_date - 1)
          AND ds.is_complete = TRUE
        LIMIT 1;

      v_streak := COALESCE(y_streak, 0) + 1;
    ELSE
      v_streak := 0;
    END IF;

    INSERT INTO public.daily_summary (
      user_id, date, timezone,
      has_overall, has_meal, has_water, has_journal, has_checkin,
      is_complete, streak_value, updated_at
    )
    VALUES (
      p_user_id, local_date, tz,
      v_has_overall, v_has_meal, v_has_water, v_has_journal, v_has_checkin,
      v_is_complete, v_streak, now()
    )
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      timezone = EXCLUDED.timezone,
      has_overall = EXCLUDED.has_overall,
      has_meal = EXCLUDED.has_meal,
      has_water = EXCLUDED.has_water,
      has_journal = EXCLUDED.has_journal,
      has_checkin = EXCLUDED.has_checkin,
      is_complete = EXCLUDED.is_complete,
      streak_value = EXCLUDED.streak_value,
      updated_at = EXCLUDED.updated_at;

    IF local_date = (today_local - 1) THEN
      UPDATE public.daily_summary t
      SET streak_value = (SELECT y.streak_value + 1
                          FROM public.daily_summary y
                          WHERE y.user_id = p_user_id
                            AND y.date = (today_local - 1)
                            AND y.is_complete = TRUE
                          LIMIT 1),
          updated_at = now()
      WHERE t.user_id = p_user_id
        AND t.date = today_local
        AND t.is_complete = TRUE;
    END IF;
  END IF;

  RETURN (
    SELECT ds FROM public.daily_summary ds
    WHERE ds.user_id = p_user_id AND ds.date = local_date
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_daily_summary(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_daily_summary(UUID, DATE) TO authenticated;
