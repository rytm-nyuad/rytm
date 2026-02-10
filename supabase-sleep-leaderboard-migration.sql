-- =====================================================
-- SLEEP CONSISTENCY LEADERBOARD MIGRATION
-- Extends existing leaderboard tables with nullable
-- sleep-specific columns for metric_key = 'sleep_consistency'.
-- Run this in Supabase SQL Editor.
-- =====================================================

-- 1. leaderboard_user_day_stats: add sleep columns ───
--    These store per-day sleep data (one row per user per day).

ALTER TABLE public.leaderboard_user_day_stats
  ADD COLUMN IF NOT EXISTS sleep_start_minutes_norm INT,   -- bedtime in normalized minutes (noon-anchor)
  ADD COLUMN IF NOT EXISTS wake_end_minutes INT,           -- wake time in plain minutes since midnight
  ADD COLUMN IF NOT EXISTS sleep_duration_minutes INT,     -- total sleep duration in minutes
  ADD COLUMN IF NOT EXISTS source TEXT;                    -- 'fitbit' or 'whoop'


-- 2. leaderboard_user_week_stats: add sleep columns ──
--    These store weekly aggregates per user.

ALTER TABLE public.leaderboard_user_week_stats
  ADD COLUMN IF NOT EXISTS earliest_sleep_minutes_norm INT, -- MIN(sleep_start_minutes_norm) for the week
  ADD COLUMN IF NOT EXISTS latest_wake_minutes INT,         -- MAX(wake_end_minutes) for the week
  ADD COLUMN IF NOT EXISTS range_minutes INT,               -- latest_wake - earliest_sleep (window width)
  ADD COLUMN IF NOT EXISTS avg_sleep_minutes INT,           -- ROUND(AVG(sleep_duration_minutes))
  ADD COLUMN IF NOT EXISTS score_minutes INT;               -- range_minutes - avg_sleep_minutes (lower = better)


-- 3. Add comments for documentation ──────────────────

COMMENT ON COLUMN public.leaderboard_user_day_stats.sleep_start_minutes_norm IS
  'Bedtime as minutes since midnight, normalized: if < 720 (noon) add 1440. E.g. 11pm = 23*60=1380, 1am = 1*60+1440=1500.';

COMMENT ON COLUMN public.leaderboard_user_day_stats.wake_end_minutes IS
  'Wake-up time as minutes since midnight (no normalization). E.g. 7am = 420.';

COMMENT ON COLUMN public.leaderboard_user_day_stats.sleep_duration_minutes IS
  'Total sleep duration in minutes for this night.';

COMMENT ON COLUMN public.leaderboard_user_day_stats.source IS
  'Data source: fitbit or whoop. WHOOP overrides Fitbit for the same day via upsert ordering.';

COMMENT ON COLUMN public.leaderboard_user_week_stats.earliest_sleep_minutes_norm IS
  'Earliest bedtime of the week (MIN of sleep_start_minutes_norm). For display: subtract 1440 if >= 1440.';

COMMENT ON COLUMN public.leaderboard_user_week_stats.latest_wake_minutes IS
  'Latest wake time of the week (MAX of wake_end_minutes).';

COMMENT ON COLUMN public.leaderboard_user_week_stats.range_minutes IS
  'Sleep window width = latest_wake_minutes - earliest_sleep_minutes_norm (after denorm).';

COMMENT ON COLUMN public.leaderboard_user_week_stats.avg_sleep_minutes IS
  'Average sleep duration across days with data this week.';

COMMENT ON COLUMN public.leaderboard_user_week_stats.score_minutes IS
  'Consistency score = range_minutes - avg_sleep_minutes. Lower is better (ascending sort).';


-- =====================================================
-- DONE — No data migration needed; new columns are
-- nullable and will be populated by the edge function
-- when metric_key = sleep_consistency.
-- =====================================================
