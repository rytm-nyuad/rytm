-- ============================================================
-- Pulses RLS Policy Hardening
-- ============================================================
-- This migration updates RLS policies to use auth.jwt() instead of auth.users
-- to avoid "permission denied for table users" errors.

-- ──────────────────────────────────────────────────────────
-- PULSES TABLE POLICIES
-- ──────────────────────────────────────────────────────────

-- Public read: anyone can read published pulses (no auth required)
DROP POLICY IF EXISTS "Public can read published pulses" ON public.pulses;
CREATE POLICY "Public can read published pulses"
ON public.pulses
FOR SELECT
USING (is_published = true);

-- Admin read all: admins can read all pulses (including drafts)
-- Uses JWT email claim to avoid auth.users lookup
DROP POLICY IF EXISTS "Admins can read all pulses" ON public.pulses;
CREATE POLICY "Admins can read all pulses"
ON public.pulses
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.pulse_admins a
    WHERE a.email = (auth.jwt() ->> 'email')
  )
);

-- Admin insert
DROP POLICY IF EXISTS "Admins can insert pulses" ON public.pulses;
CREATE POLICY "Admins can insert pulses"
ON public.pulses
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pulse_admins a
    WHERE a.email = (auth.jwt() ->> 'email')
  )
);

-- Admin update
DROP POLICY IF EXISTS "Admins can update pulses" ON public.pulses;
CREATE POLICY "Admins can update pulses"
ON public.pulses
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.pulse_admins a
    WHERE a.email = (auth.jwt() ->> 'email')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.pulse_admins a
    WHERE a.email = (auth.jwt() ->> 'email')
  )
);

-- Admin delete
DROP POLICY IF EXISTS "Admins can delete pulses" ON public.pulses;
CREATE POLICY "Admins can delete pulses"
ON public.pulses
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.pulse_admins a
    WHERE a.email = (auth.jwt() ->> 'email')
  )
);

-- ──────────────────────────────────────────────────────────
-- PULSE_ADMINS TABLE POLICIES
-- ──────────────────────────────────────────────────────────

-- Simple policy: you can read your own admin row
-- No recursion - just checks if the row's email matches your JWT email
DROP POLICY IF EXISTS "Admins can read admin list" ON public.pulse_admins;
CREATE POLICY "Admins can read admin list"
ON public.pulse_admins
FOR SELECT
USING (email = (auth.jwt() ->> 'email'));
