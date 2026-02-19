-- ============================================================
-- DIAGNOSTIC QUERY: Check why checklist items aren't showing
-- Run this in Supabase SQL Editor to see what's wrong
-- Replace YOUR_USER_ID with your actual user_id UUID
-- ============================================================

-- First, let's see your timezone
SELECT 
  fp.user_timezone as fitbit_tz,
  p.timezone as profile_tz
FROM fitbit_profile fp
FULL OUTER JOIN profiles p ON fp.app_user_id = p.id
WHERE fp.app_user_id = 'YOUR_USER_ID' OR p.id = 'YOUR_USER_ID';

-- Check today's daily_summary row
SELECT 
  date,
  has_overall,
  has_meal,
  has_water,
  has_journal,
  has_checkin,
  is_complete,
  streak_value,
  updated_at
FROM daily_summary
WHERE user_id = 'YOUR_USER_ID'
  AND date >= CURRENT_DATE - INTERVAL '2 days'
ORDER BY date DESC;

-- Check actual source data for today
-- (Replace 'America/New_York' with your timezone from above)
WITH tz_info AS (
  SELECT 'America/New_York'::text AS tz,
         CURRENT_DATE AS local_date,
         (CURRENT_DATE::timestamp AT TIME ZONE 'America/New_York') AS start_utc,
         ((CURRENT_DATE + 1)::timestamp AT TIME ZONE 'America/New_York') AS end_utc
)
SELECT
  'daily_overall' AS source,
  EXISTS(
    SELECT 1 FROM daily_overall o, tz_info
    WHERE o.user_id = 'YOUR_USER_ID' 
      AND o.date = tz_info.local_date
  ) AS has_data,
  (SELECT COUNT(*) FROM daily_overall o, tz_info 
   WHERE o.user_id = 'YOUR_USER_ID' AND o.date = tz_info.local_date) AS count
UNION ALL
SELECT
  'meal_logs' AS source,
  EXISTS(
    SELECT 1 FROM meal_logs m, tz_info
    WHERE m.user_id = 'YOUR_USER_ID'
      AND m.meal_datetime >= tz_info.start_utc
      AND m.meal_datetime < tz_info.end_utc
  ) AS has_data,
  (SELECT COUNT(*) FROM meal_logs m, tz_info 
   WHERE m.user_id = 'YOUR_USER_ID' 
     AND m.meal_datetime >= tz_info.start_utc 
     AND m.meal_datetime < tz_info.end_utc) AS count
UNION ALL
SELECT
  'journal_messages' AS source,
  EXISTS(
    SELECT 1 FROM journal_messages j, tz_info
    WHERE j.user_id = 'YOUR_USER_ID'
      AND j.created_at >= tz_info.start_utc
      AND j.created_at < tz_info.end_utc
  ) AS has_data,
  (SELECT COUNT(*) FROM journal_messages j, tz_info 
   WHERE j.user_id = 'YOUR_USER_ID' 
     AND j.created_at >= tz_info.start_utc 
     AND j.created_at < tz_info.end_utc) AS count
UNION ALL
SELECT
  'daily_checkins' AS source,
  EXISTS(
    SELECT 1 FROM daily_checkins c, tz_info
    WHERE c.user_id = 'YOUR_USER_ID'
      AND c.created_at >= tz_info.start_utc
      AND c.created_at < tz_info.end_utc
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
  ) AS has_data,
  (SELECT COUNT(*) FROM daily_checkins c, tz_info 
   WHERE c.user_id = 'YOUR_USER_ID' 
     AND c.created_at >= tz_info.start_utc 
     AND c.created_at < tz_info.end_utc) AS count;

-- Check the actual refresh_daily_summary function definition
-- to see if it has the correct completion logic
SELECT 
  pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'refresh_daily_summary'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
