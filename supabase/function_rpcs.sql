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

  v_is_complete := v_has_overall AND v_has_meal AND v_has_water AND v_has_journal AND v_has_checkin;

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
        ts := public._safe_event_time_utc(p_local_date, tz, NULL); -- noon local fallback
      END IF;

    EXCEPTION WHEN others THEN
      -- If parsing fails, fallback to safe time logic
      ts := public._safe_event_time_utc(p_local_date, tz, COALESCE(p_at, now()));
    END;

  ELSE
    -- CASE 2: no local time provided:
    -- - if p_at is today-ish, it will be within window
    -- - else it falls back to noon local (because now() will be outside window for backlogs)
    ts := public._safe_event_time_utc(p_local_date, tz, COALESCE(p_at, now()));
  END IF;

  -- Insert meal log
  INSERT INTO public.meal_logs (
    user_id, meal_type, description, photo_url, meal_datetime
  )
  VALUES (
    p_user_id, p_meal_type, p_description, p_photo_url, ts
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
