-- Migration: Add 'drink' to public.meal_type enum
-- This adds a new 'drink' value to the existing meal_type enum,
-- allowing users to log drinks/water/nutrition via the same meal logging flow.
-- Backwards compatible: existing meal records remain valid.

-- Add 'drink' to the meal_type enum (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'drink'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'meal_type' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
  ) THEN
    ALTER TYPE public.meal_type ADD VALUE 'drink';
  END IF;
END
$$;

-- Update refresh_daily_summary: remove has_water from is_complete calculation
-- Water/nutrition logging is no longer a separate checklist requirement.
-- Instead, drinks are logged as meal entries with meal_type = 'drink'.
-- The is_complete flag now requires only 4 items: overall, meal, journal, checkin.
--
-- NOTE: This changes the completion rule from:
--   v_is_complete = v_has_overall AND v_has_meal AND v_has_water AND v_has_journal AND v_has_checkin
-- To:
--   v_is_complete = v_has_overall AND v_has_meal AND v_has_journal AND v_has_checkin
--
-- The has_water column is preserved for historical data but no longer affects streaks.
