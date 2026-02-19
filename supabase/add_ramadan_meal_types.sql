-- Migration: Add Ramadan meal types to public.meal_type enum
-- This adds two new values to the existing meal_type enum:
--   - 'ramadan_iftar'  (breaking fast at sunset)
--   - 'ramadan_suhoor' (pre-dawn meal)
-- These values allow users to log Ramadan-specific meals.
-- Backwards compatible: existing meal records remain valid.

-- Add 'ramadan_iftar' to the meal_type enum (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'ramadan_iftar'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'meal_type' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
  ) THEN
    ALTER TYPE public.meal_type ADD VALUE 'ramadan_iftar';
    RAISE NOTICE 'Added "ramadan_iftar" to meal_type enum';
  ELSE
    RAISE NOTICE '"ramadan_iftar" already exists in meal_type enum';
  END IF;
END
$$;

-- Add 'ramadan_suhoor' to the meal_type enum (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'ramadan_suhoor'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'meal_type' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
  ) THEN
    ALTER TYPE public.meal_type ADD VALUE 'ramadan_suhoor';
    RAISE NOTICE 'Added "ramadan_suhoor" to meal_type enum';
  ELSE
    RAISE NOTICE '"ramadan_suhoor" already exists in meal_type enum';
  END IF;
END
$$;

-- Note: These meal types will automatically be accepted by:
-- - log_meal_for_date() RPC function (uses public.meal_type parameter)
-- - refresh_daily_summary() function (counts ANY meal_logs entry as has_meal)
-- - All existing RLS policies (user_id based, not meal_type dependent)
--
-- Frontend and tests will need to be updated separately to include these options.
