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

  -- CHANGE: grace window control (only yesterday+today affect streak)
  GRACE_DAYS CONSTANT INTEGER := 1;
  today_local DATE;
  grace_start DATE;
  existing_streak INTEGER;
BEGIN
  -- KEEP: auth guard
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- KEEP: tz resolution (fitbit -> profiles -> UTC)
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
  -- KEEP: local_date selection
  IF p_target_date IS NULL THEN
    local_date := (now() AT TIME ZONE tz)::date;
  ELSE
    local_date := p_target_date;
  END IF;

  -- 4am local boundary backlog detection (use server receipt time)
  -- (compute after we know local_date)
  client_ts := now();
  client_day := ((client_ts AT TIME ZONE tz) - INTERVAL '4 hours')::date;
  IF client_day <> local_date THEN
    is_backlogged := TRUE;
  END IF;

  -- CHANGE: define today_local and grace_start (yesterday)
  today_local := (now() AT TIME ZONE tz)::date;
  grace_start := today_local - GRACE_DAYS;

  -- KEEP: compute day UTC window
  start_utc := (local_date::timestamp AT TIME ZONE tz);
  end_utc   := ((local_date + 1)::timestamp AT TIME ZONE tz);

  -- KEEP: requirement checks
  SELECT EXISTS (
    SELECT 1 FROM public.daily_overall o
    WHERE o.user_id = p_user_id AND o.date = local_date
  ) INTO v_has_overall;

  SELECT EXISTS (
    SELECT 1 FROM public.meal_logs m
    WHERE m.user_id = p_user_id
      AND m.meal_local_date = local_date
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

  -- CHANGE: water logging is no longer required for day completion.
  -- Drinks are now logged as meal entries (meal_type = 'drink').
  -- Completion requires 4 items: overall, meal, journal, checkin.
  v_is_complete := v_has_overall AND v_has_meal AND v_has_journal AND v_has_checkin;

  -- CHANGE: bounded streak logic
  IF local_date < grace_start THEN
    -- older backlog: do NOT rewrite streak history
    SELECT ds.streak_value INTO existing_streak
      FROM public.daily_summary ds
      WHERE ds.user_id = p_user_id AND ds.date = local_date
      LIMIT 1;

    v_streak := COALESCE(existing_streak, 0);

    -- upsert flags + is_complete only (do NOT update streak_value on conflict)
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
    -- today/yesterday: compute streak normally
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

    -- CHANGE: if yesterday is refreshed and became complete, repair today's streak if today is complete
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


-- 1) Recreate single canonical function
CREATE OR REPLACE FUNCTION public.log_meal_for_date(
  p_user_id UUID,
  p_local_date DATE,
  p_meal_type public.meal_type,
  p_description TEXT DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,

  -- NEW: user-entered local time like "06:02 PM" (optional)
  p_local_time TEXT DEFAULT NULL,

  -- optional exact timestamp for today (client), but server will also fallback to now()
  p_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz TEXT;
  ts TIMESTAMPTZ;

  start_utc TIMESTAMPTZ;
  end_utc   TIMESTAMPTZ;

  parsed_time TIME;
  local_ts TIMESTAMP;

  client_ts TIMESTAMPTZ;
  client_day DATE;
  is_backlogged BOOLEAN := FALSE;
BEGIN
  -- Auth guard
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- tz: fitbit -> profiles -> UTC
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

  -- Compute UTC day window for safety checks
  start_utc := (p_local_date::timestamp AT TIME ZONE tz);
  end_utc   := ((p_local_date + 1)::timestamp AT TIME ZONE tz);

  -- 4am local boundary backlog detection (client receipt time)
  client_ts := now();
  client_day := ((client_ts AT TIME ZONE tz) - INTERVAL '4 hours')::date;
  IF client_day <> p_local_date::date THEN
    is_backlogged := TRUE;
  END IF;

  -- CASE 1: user provided local time like "06:02 PM"
  IF p_local_time IS NOT NULL AND length(trim(p_local_time)) > 0 THEN
    BEGIN
      -- Parse "06:02 PM" / "6:02 PM" using a strict format
      parsed_time := to_timestamp(trim(p_local_time), 'HH12:MI AM')::time;

      -- Combine local date + local time (timestamp WITHOUT tz), then interpret in tz => UTC timestamptz
      local_ts := (p_local_date::timestamp + parsed_time);
      ts := (local_ts AT TIME ZONE tz);

      -- Safety: ensure computed ts lands inside that day's window
      IF NOT (ts >= start_utc AND ts < end_utc) THEN
        ts := NULL;
      END IF;

    EXCEPTION WHEN others THEN
      -- If parsing fails, preserve the meal's day but leave exact time unknown.
      ts := NULL;
    END;

  ELSE
    -- CASE 2: no local time provided. Preserve the day membership only.
    ts := NULL;
  END IF;

  -- Insert meal log
  INSERT INTO public.meal_logs (
    user_id, meal_type, description, photo_url, meal_local_date, meal_datetime
  )
  VALUES (
    p_user_id, p_meal_type, p_description, p_photo_url, p_local_date, ts
  );

  -- Refresh daily summary for that local date
  PERFORM public.refresh_daily_summary(p_user_id, p_local_date);

  -- If this write was a backlog according to 4am rule, mark the day's summary
  IF is_backlogged THEN
    UPDATE public.daily_summary
    SET is_backlogged = TRUE, updated_at = now()
    WHERE user_id = p_user_id AND date = p_local_date;
  END IF;

  RETURN TRUE;

EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'log_meal_for_date failed: %', SQLERRM;
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.log_meal_for_date(UUID, DATE, public.meal_type, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_meal_for_date(UUID, DATE, public.meal_type, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;


-- ============================================================
-- J1) Journal insert wrapper (supports backlogging)
-- Inserts into public.journal_messages with:
--   - local_date (canonical day)
--   - timezone (canonical tz)
--   - created_at chosen to fall within that local day window
-- Then refreshes daily_summary for that local_date.
-- ============================================================

CREATE OR REPLACE FUNCTION public.log_journal_message_for_date(
  p_user_id UUID,
  p_mode TEXT,
  p_role TEXT,
  p_content TEXT,
  p_local_date DATE DEFAULT NULL,          -- NULL => server picks "today" in canonical tz
  p_thread_id UUID DEFAULT NULL,
  p_at TIMESTAMPTZ DEFAULT NULL            -- optional override; usually leave NULL
)
RETURNS public.journal_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz TEXT;
  local_date DATE;
  ts TIMESTAMPTZ;
  client_ts TIMESTAMPTZ;
  client_day DATE;
  is_backlogged BOOLEAN := FALSE;
  msg public.journal_messages%ROWTYPE;
BEGIN
  -- Guard: only allow user to write their own messages
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Resolve canonical timezone: Fitbit -> profiles -> UTC
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

  -- Determine local_date
  IF p_local_date IS NULL THEN
    local_date := (now() AT TIME ZONE tz)::date;
  ELSE
    local_date := p_local_date;
  END IF;

  -- Choose created_at:
  -- - if caller provided p_at => use it
  -- - else if local_date is "today" in canonical tz => use now()
  -- - else => noon local time (converted to UTC)
  IF p_at IS NOT NULL THEN
    ts := p_at;
  ELSE
    IF local_date = (now() AT TIME ZONE tz)::date THEN
      ts := now();
    ELSE
      ts := ((local_date::timestamp + interval '12 hours') AT TIME ZONE tz);
    END IF;
  END IF;

  -- 4am local boundary backlog detection (use server receipt time)
  client_ts := now();
  client_day := ((client_ts AT TIME ZONE tz) - INTERVAL '4 hours')::date;
  IF client_day <> local_date THEN
    is_backlogged := TRUE;
  END IF;

  INSERT INTO public.journal_messages (
    user_id, thread_id, mode, role, content,
    created_at, local_date, timezone
  )
  VALUES (
    p_user_id, p_thread_id, p_mode, p_role, p_content,
    ts, local_date, tz
  )
  RETURNING * INTO msg;

  -- Keep daily_summary consistent for this day
  PERFORM public.refresh_daily_summary(p_user_id, local_date);

  IF is_backlogged THEN
    UPDATE public.daily_summary
    SET is_backlogged = TRUE, updated_at = now()
    WHERE user_id = p_user_id AND date = local_date;
  END IF;

  RETURN msg;
END;
$$;

REVOKE ALL ON FUNCTION public.log_journal_message_for_date(UUID, TEXT, TEXT, TEXT, DATE, UUID, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_journal_message_for_date(UUID, TEXT, TEXT, TEXT, DATE, UUID, TIMESTAMPTZ) TO authenticated;


-- ============================================================
-- STEP 2: RPC INSERT WRAPPERS for backlogging
--   - Each wrapper:
--       * enforces auth.uid() == p_user_id
--       * computes tz (fitbit -> profiles -> UTC)
--       * chooses timestamp (p_at if within day window; else noon local)
--       * inserts
--       * refreshes daily_summary for that date
-- ============================================================

-- Helper to compute a safe timestamptz for a given local_date + tz
-- If p_at provided but outside day window, fallback to noon local.
CREATE OR REPLACE FUNCTION public._safe_event_time_utc(
  p_local_date DATE,
  p_tz TEXT,
  p_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_utc TIMESTAMPTZ;
  end_utc   TIMESTAMPTZ;
  noon_utc  TIMESTAMPTZ;
BEGIN
  start_utc := (p_local_date::timestamp AT TIME ZONE p_tz);
  end_utc   := ((p_local_date + 1)::timestamp AT TIME ZONE p_tz);
  noon_utc  := ((p_local_date::timestamp + interval '12 hours') AT TIME ZONE p_tz);

  IF p_at IS NULL THEN
    RETURN noon_utc;
  END IF;

  IF p_at >= start_utc AND p_at < end_utc THEN
    RETURN p_at;
  END IF;

  RETURN noon_utc;
END;
$$;

REVOKE ALL ON FUNCTION public._safe_event_time_utc(DATE, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._safe_event_time_utc(DATE, TEXT, TIMESTAMPTZ) FROM authenticated;


-- ----------------------------
-- Submit overall for a date
-- ----------------------------
CREATE OR REPLACE FUNCTION public.submit_overall_for_date(
  p_user_id UUID,
  p_local_date DATE,
  p_score INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz TEXT;
  client_ts TIMESTAMPTZ;
  client_day DATE;
  is_backlogged BOOLEAN := FALSE;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- tz: fitbit -> profiles -> UTC
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

  -- Upsert overall (assumes unique (user_id,date) is ideal; if not present, it will still insert duplicates.
  -- If you have a unique constraint, this is perfect. If not, consider adding one.
  INSERT INTO public.daily_overall (user_id, date, overall_score)
  VALUES (p_user_id, p_local_date, p_score)
  ON CONFLICT (user_id, date)
  DO UPDATE SET overall_score = EXCLUDED.overall_score;

  PERFORM public.refresh_daily_summary(p_user_id, p_local_date);
  IF is_backlogged THEN
    UPDATE public.daily_summary
    SET is_backlogged = TRUE, updated_at = now()
    WHERE user_id = p_user_id AND date = p_local_date;
  END IF;
  RETURN TRUE;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'submit_overall_for_date failed: %', SQLERRM;
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_overall_for_date(UUID, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_overall_for_date(UUID, DATE, INTEGER) TO authenticated;

-- ----------------------------
-- Compute daily_nutrition2 for a local date
-- ----------------------------
CREATE OR REPLACE FUNCTION public.compute_daily_nutrition2(
  p_user_id UUID,
  p_date DATE,
  p_tz TEXT
)
RETURNS public.daily_nutrition2
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz TEXT;
  start_utc TIMESTAMPTZ;
  end_utc TIMESTAMPTZ;
  result_row public.daily_nutrition2%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  v_tz := NULLIF(trim(p_tz), '');
  IF v_tz IS NULL THEN
    v_tz := 'UTC';
  END IF;

  start_utc := (p_date::timestamp AT TIME ZONE v_tz);
  end_utc := ((p_date + 1)::timestamp AT TIME ZONE v_tz);

  WITH successful_runs AS (
    SELECT
      ml.id AS meal_id,
      ml.user_id,
      ml.meal_type,
      ml.meal_local_date,
      ml.meal_datetime,
      CASE
        WHEN ml.meal_datetime IS NULL THEN NULL
        ELSE FLOOR(
          EXTRACT(
            EPOCH FROM ((ml.meal_datetime AT TIME ZONE v_tz)::time - time '00:00')
          ) / 60.0
        )::int
      END AS meal_minutes_local,
      GREATEST(COALESCE((mpr.totals->>'kcal')::numeric, 0), 50) AS confidence_weight,
      GREATEST(LEAST(COALESCE(mpr.confidence_score, 0), 100), 0) / 100.0 AS confidence_norm,
      (mpr.totals->>'kcal')::numeric AS kcal,
      (mpr.totals->>'protein_g')::numeric AS protein_g,
      (mpr.totals->>'carbs_g')::numeric AS carbs_g,
      (mpr.totals->>'fat_g')::numeric AS fat_g,
      (mpr.totals->>'sugar_g')::numeric AS sugar_g
    FROM public.meal_logs ml
    JOIN LATERAL (
      SELECT
        mpr.meal_id,
        mpr.confidence_score,
        mpr.totals,
        mpr.processed_at,
        mpr.created_at
      FROM public.meal_processing_runs mpr
      WHERE mpr.meal_id = ml.id
        AND mpr.user_id = p_user_id
        AND mpr.status = 'success'
      ORDER BY COALESCE(mpr.processed_at, mpr.created_at) DESC, mpr.created_at DESC
      LIMIT 1
    ) mpr ON TRUE
    WHERE ml.user_id = p_user_id
      AND ml.meal_local_date = p_date
  ),
  aggregated AS (
    SELECT
      p_user_id AS user_id,
      p_date AS date,
      'daily_nutrition2_v1'::text AS aggregation_pipeline_version,
      SUM(sr.kcal) AS total_kcal_day,
      SUM(sr.protein_g) AS protein_g_day,
      SUM(sr.carbs_g) AS carbs_g_day,
      SUM(sr.fat_g) AS fat_g_day,
      SUM(sr.sugar_g) AS sugar_g_day,
      COUNT(*)::int AS meal_count_day,
      BOOL_OR(sr.meal_type = 'breakfast') AS breakfast_logged,
      BOOL_OR(sr.meal_type = 'lunch') AS lunch_logged,
      BOOL_OR(sr.meal_type = 'dinner') AS dinner_logged,
      MIN(sr.meal_minutes_local) FILTER (WHERE sr.meal_minutes_local IS NOT NULL) AS time_first_meal_minutes,
      MAX(sr.meal_minutes_local) FILTER (WHERE sr.meal_minutes_local IS NOT NULL) AS time_last_meal_minutes,
      CASE
        WHEN COUNT(sr.meal_minutes_local) = 0 THEN NULL
        ELSE
          MAX(sr.meal_minutes_local) FILTER (WHERE sr.meal_minutes_local IS NOT NULL)
          - MIN(sr.meal_minutes_local) FILTER (WHERE sr.meal_minutes_local IS NOT NULL)
      END AS eating_window_minutes,
      CASE
        WHEN COUNT(*) = 0 THEN 0.0
        ELSE COALESCE(SUM(sr.confidence_weight * sr.confidence_norm) / NULLIF(SUM(sr.confidence_weight), 0), 0.0)
      END AS nutrition_confidence_day,
      (COUNT(*) = 0) AS meals_missing_day
    FROM successful_runs sr
  )
  INSERT INTO public.daily_nutrition2 (
    user_id,
    date,
    aggregation_pipeline_version,
    total_kcal_day,
    protein_g_day,
    carbs_g_day,
    fat_g_day,
    sugar_g_day,
    meal_count_day,
    breakfast_logged,
    lunch_logged,
    dinner_logged,
    time_first_meal_minutes,
    time_last_meal_minutes,
    eating_window_minutes,
    nutrition_confidence_day,
    meals_missing_day
  )
  SELECT
    a.user_id,
    a.date,
    a.aggregation_pipeline_version,
    a.total_kcal_day,
    a.protein_g_day,
    a.carbs_g_day,
    a.fat_g_day,
    a.sugar_g_day,
    a.meal_count_day,
    COALESCE(a.breakfast_logged, FALSE),
    COALESCE(a.lunch_logged, FALSE),
    COALESCE(a.dinner_logged, FALSE),
    a.time_first_meal_minutes,
    a.time_last_meal_minutes,
    a.eating_window_minutes,
    a.nutrition_confidence_day,
    a.meals_missing_day
  FROM aggregated a
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    aggregation_pipeline_version = EXCLUDED.aggregation_pipeline_version,
    total_kcal_day = EXCLUDED.total_kcal_day,
    protein_g_day = EXCLUDED.protein_g_day,
    carbs_g_day = EXCLUDED.carbs_g_day,
    fat_g_day = EXCLUDED.fat_g_day,
    sugar_g_day = EXCLUDED.sugar_g_day,
    meal_count_day = EXCLUDED.meal_count_day,
    breakfast_logged = EXCLUDED.breakfast_logged,
    lunch_logged = EXCLUDED.lunch_logged,
    dinner_logged = EXCLUDED.dinner_logged,
    time_first_meal_minutes = EXCLUDED.time_first_meal_minutes,
    time_last_meal_minutes = EXCLUDED.time_last_meal_minutes,
    eating_window_minutes = EXCLUDED.eating_window_minutes,
    nutrition_confidence_day = EXCLUDED.nutrition_confidence_day,
    meals_missing_day = EXCLUDED.meals_missing_day
  RETURNING * INTO result_row;

  IF NOT FOUND THEN
    INSERT INTO public.daily_nutrition2 (
      user_id,
      date,
      aggregation_pipeline_version,
      meal_count_day,
      breakfast_logged,
      lunch_logged,
      dinner_logged,
      nutrition_confidence_day,
      meals_missing_day
    )
    VALUES (
      p_user_id,
      p_date,
      'daily_nutrition2_v1',
      0,
      FALSE,
      FALSE,
      FALSE,
      0.0,
      TRUE
    )
    ON CONFLICT (user_id, date)
    DO UPDATE SET
      aggregation_pipeline_version = EXCLUDED.aggregation_pipeline_version,
      total_kcal_day = NULL,
      protein_g_day = NULL,
      carbs_g_day = NULL,
      fat_g_day = NULL,
      sugar_g_day = NULL,
      meal_count_day = 0,
      breakfast_logged = FALSE,
      lunch_logged = FALSE,
      dinner_logged = FALSE,
      time_first_meal_minutes = NULL,
      time_last_meal_minutes = NULL,
      eating_window_minutes = NULL,
      nutrition_confidence_day = 0.0,
      meals_missing_day = TRUE
    RETURNING * INTO result_row;
  END IF;

  RETURN result_row;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_daily_nutrition2(UUID, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_daily_nutrition2(UUID, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_daily_nutrition2(UUID, DATE, TEXT) TO service_role;

-- ----------------------------
-- Log water for a date
-- ----------------------------
CREATE OR REPLACE FUNCTION public.log_water_for_date(
  p_user_id UUID,
  p_local_date DATE,
  p_amount_ml INTEGER,
  p_source TEXT,
  p_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz TEXT;
  ts TIMESTAMPTZ;
  client_ts TIMESTAMPTZ;
  client_day DATE;
  is_backlogged BOOLEAN := FALSE;
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

  -- compute backlog using 4am local boundary
  client_ts := now();
  client_day := ((client_ts AT TIME ZONE tz) - INTERVAL '4 hours')::date;
  IF client_day <> p_local_date::date THEN
    is_backlogged := TRUE;
  END IF;

  ts := public._safe_event_time_utc(p_local_date, tz, p_at);

  INSERT INTO public.water_intake_logs (
    user_id, amount_ml, source, intake_datetime
  )
  VALUES (
    p_user_id, p_amount_ml, p_source, ts
  );

  PERFORM public.refresh_daily_summary(p_user_id, p_local_date);
  IF is_backlogged THEN
    UPDATE public.daily_summary
    SET is_backlogged = TRUE, updated_at = now()
    WHERE user_id = p_user_id AND date = p_local_date;
  END IF;
  RETURN TRUE;
EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'log_water_for_date failed: %', SQLERRM;
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.log_water_for_date(UUID, DATE, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_water_for_date(UUID, DATE, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;


-- ----------------------------
-- Submit check-in for a date
-- ----------------------------
CREATE OR REPLACE FUNCTION public.submit_checkin_for_date(
  p_user_id UUID,
  p_local_date DATE,
  p_sleep_quality INTEGER,
  p_energy_score INTEGER,
  p_focus_score INTEGER,
  p_workload_score INTEGER,
  p_coping_capacity_score INTEGER,
  p_stress_score INTEGER,
  p_stress_unexpected_score INTEGER,
  p_social_score INTEGER,
  p_mood_score INTEGER,
  p_mood_stability_score INTEGER,
  p_mood_emotions TEXT[],
  p_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz TEXT;
  ts TIMESTAMPTZ;
  client_ts TIMESTAMPTZ;
  client_day DATE;
  is_backlogged BOOLEAN := FALSE;
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

  -- compute backlog using 4am local boundary
  client_ts := now();
  client_day := ((client_ts AT TIME ZONE tz) - INTERVAL '4 hours')::date;
  IF client_day <> p_local_date::date THEN
    is_backlogged := TRUE;
  END IF;

  ts := public._safe_event_time_utc(p_local_date, tz, p_at);

  INSERT INTO public.daily_checkins (
    user_id,
    checkin_date,               -- CHANGE: required column
    sleep_quality,
    energy_score,
    focus_score,
    workload_score,
    coping_capacity_score,
    stress_score,
    stress_unexpected_score,
    social_score,
    mood_score,
    mood_stability_score,
    mood_emotions,
    created_at
  )
  VALUES (
    p_user_id,
    p_local_date,               -- CHANGE: set checkin_date
    p_sleep_quality,
    p_energy_score,
    p_focus_score,
    p_workload_score,
    p_coping_capacity_score,
    p_stress_score,
    p_stress_unexpected_score,
    p_social_score,
    p_mood_score,
    p_mood_stability_score,
    p_mood_emotions,
    ts
  );

  PERFORM public.refresh_daily_summary(p_user_id, p_local_date);
  IF is_backlogged THEN
    UPDATE public.daily_summary
    SET is_backlogged = TRUE, updated_at = now()
    WHERE user_id = p_user_id AND date = p_local_date;
  END IF;
  RETURN TRUE;

EXCEPTION
  WHEN others THEN
    RAISE NOTICE 'submit_checkin_for_date failed: %', SQLERRM;
    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_checkin_for_date(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_checkin_for_date(UUID, DATE, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT[], TIMESTAMPTZ) TO authenticated;

-- =====================================================
-- JOURNAL THREAD MANAGEMENT
-- =====================================================

/**
 * get_or_create_active_thread
 * 
 * Gets an existing active thread for the user on the given session date and type,
 * or creates a new one if none exists.
 * 
 * Key design: Ensures only ONE active thread per user per session_date_local per journal_type.
 * This prevents double-counting when user navigates to past sessions.
 * 
 * Args:
 *   p_user_id: User making the request
 *   p_journal_type: 'free' or 'guided'
 *   p_session_date_local: Local date (in user's timezone) for this session
 *   p_session_timezone: Canonical timezone of the user at session creation
 * 
 * Returns: thread_id (UUID)
 */
CREATE OR REPLACE FUNCTION public.get_or_create_active_thread(
  p_user_id UUID,
  p_journal_type TEXT DEFAULT 'free',
  p_session_date_local DATE DEFAULT NULL,
  p_session_timezone TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread_id UUID;
  v_session_date DATE;
  v_session_tz TEXT;
  v_tz TEXT;
BEGIN
  -- Guard: only allow user to access their own threads
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Determine session date and timezone
  -- If caller didn't provide them, compute canonical ones
  IF p_session_date_local IS NULL THEN
    -- Resolve canonical timezone: Fitbit -> profiles -> UTC
    SELECT fp.user_timezone INTO v_tz
      FROM public.fitbit_profile fp
      WHERE fp.app_user_id = p_user_id
      LIMIT 1;

    IF v_tz IS NULL OR length(trim(v_tz)) = 0 THEN
      v_tz := public.get_profile_timezone(p_user_id);
    END IF;

    IF v_tz IS NULL OR length(trim(v_tz)) = 0 THEN
      v_tz := 'UTC';
    END IF;

    v_session_date := (now() AT TIME ZONE v_tz)::date;
  ELSE
    v_session_date := p_session_date_local;
  END IF;

  IF p_session_timezone IS NULL THEN
    SELECT fp.user_timezone INTO v_session_tz
      FROM public.fitbit_profile fp
      WHERE fp.app_user_id = p_user_id
      LIMIT 1;

    IF v_session_tz IS NULL OR length(trim(v_session_tz)) = 0 THEN
      v_session_tz := public.get_profile_timezone(p_user_id);
    END IF;

    IF v_session_tz IS NULL OR length(trim(v_session_tz)) = 0 THEN
      v_session_tz := 'UTC';
    END IF;
  ELSE
    v_session_tz := p_session_timezone;
  END IF;

  -- Try to find an active thread for this user, date, and type
  -- Key: Check session_date_local instead of DATE(created_at) to prevent double-counting
  --       when user navigates to old sessions
  SELECT id INTO v_thread_id
  FROM journal_threads
  WHERE user_id = p_user_id
    AND status = 'active'
    AND journal_type = p_journal_type
    AND session_date_local = v_session_date
  ORDER BY last_message_at DESC
  LIMIT 1;

  -- If no thread exists, create one with session metadata
  IF v_thread_id IS NULL THEN
    INSERT INTO journal_threads (
      user_id, 
      title, 
      journal_type, 
      session_date_local, 
      session_timezone
    )
    VALUES (
      p_user_id, 
      CASE 
        WHEN p_journal_type = 'guided' THEN 'Guided Journal - ' || TO_CHAR(v_session_date, 'YYYY-MM-DD')
        ELSE 'Free Journal - ' || TO_CHAR(v_session_date, 'YYYY-MM-DD')
      END,
      p_journal_type,
      v_session_date,
      v_session_tz
    )
    RETURNING id INTO v_thread_id;
  END IF;

  RETURN v_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_active_thread(UUID, TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_active_thread(UUID, TEXT, DATE, TEXT) TO authenticated;

/**
 * get_user_journal_threads
 * 
 * Returns list of journal threads for a user, sorted by most recent activity.
 * Includes session metadata (session_date_local, session_timezone) for proper
 * navigation to past sessions.
 * 
 * Args:
 *   p_user_id: User requesting their threads
 *   p_limit: Max number of threads to return (default 50)
 * 
 * Returns: Table with thread details, message count, and session metadata
 */
CREATE OR REPLACE FUNCTION public.get_user_journal_threads(
  p_user_id UUID,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  journal_type TEXT,
  status TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  message_count BIGINT,
  session_date_local DATE,
  session_timezone TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: only allow user to access their own threads
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  RETURN QUERY
  SELECT 
    t.id,
    t.title,
    t.journal_type,
    t.status,
    t.last_message_at,
    t.created_at,
    COUNT(m.id)::BIGINT as message_count,
    t.session_date_local,
    t.session_timezone
  FROM journal_threads t
  LEFT JOIN journal_messages m ON m.thread_id = t.id
  WHERE t.user_id = p_user_id
  GROUP BY t.id, t.title, t.journal_type, t.status, t.last_message_at, t.created_at, t.session_date_local, t.session_timezone
  ORDER BY t.last_message_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_journal_threads(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_journal_threads(UUID, INT) TO authenticated;

/**
 * delete_journal_thread
 * 
 * Deletes a journal thread and all associated messages.
 * Requires ownership (user must be the thread owner).
 * 
 * Args:
 *   p_thread_id: ID of thread to delete
 *   p_user_id: User requesting deletion (must own the thread)
 * 
 * Returns: TRUE if deleted, FALSE if not found or unauthorized
 */
CREATE OR REPLACE FUNCTION public.delete_journal_thread(
  p_thread_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Guard: only allow user to delete their own threads
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  -- Verify ownership
  SELECT COUNT(*) INTO v_count
  FROM journal_threads
  WHERE id = p_thread_id AND user_id = p_user_id;
  
  IF v_count = 0 THEN
    RETURN FALSE;
  END IF;
  
  -- Delete messages first (CASCADE should handle this, but being explicit)
  DELETE FROM journal_messages
  WHERE thread_id = p_thread_id AND user_id = p_user_id;
  
  -- Delete thread
  DELETE FROM journal_threads
  WHERE id = p_thread_id AND user_id = p_user_id;
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_journal_thread(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_journal_thread(UUID, UUID) TO authenticated;
