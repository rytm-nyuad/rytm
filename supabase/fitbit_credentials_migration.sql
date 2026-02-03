-- Migration: Add status tracking columns to fitbit_credentials
-- This migration adds columns for handling Fitbit OAuth token refresh failures
-- and marking users who need to re-authenticate.

-- Add status column to track if user has valid credentials
ALTER TABLE public.fitbit_credentials
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Add timestamp for when reauth was required (null if not needed)
ALTER TABLE public.fitbit_credentials
ADD COLUMN IF NOT EXISTS reauth_required_at TIMESTAMPTZ NULL;

-- Add timestamp for last successful token refresh
ALTER TABLE public.fitbit_credentials
ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMPTZ NULL;

-- Add column to store the last refresh error message
ALTER TABLE public.fitbit_credentials
ADD COLUMN IF NOT EXISTS last_refresh_error TEXT NULL;

-- Add lock TTL column to prevent concurrent refresh attempts
-- Set to a future timestamp when refresh is in progress
-- NULL or past timestamp means no lock is held
ALTER TABLE public.fitbit_credentials
ADD COLUMN IF NOT EXISTS refresh_in_progress_until TIMESTAMPTZ NULL;

-- Add expires_at column if it doesn't exist (some schemas may already have it)
ALTER TABLE public.fitbit_credentials
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

-- Add comment to document the status values
COMMENT ON COLUMN public.fitbit_credentials.status IS 'Connection status: active (valid tokens) or needs_reauth (user must reconnect)';
COMMENT ON COLUMN public.fitbit_credentials.reauth_required_at IS 'Timestamp when the user was marked as needing re-authentication';
COMMENT ON COLUMN public.fitbit_credentials.last_refresh_at IS 'Timestamp of last successful token refresh';
COMMENT ON COLUMN public.fitbit_credentials.last_refresh_error IS 'Last refresh error message for debugging';
COMMENT ON COLUMN public.fitbit_credentials.refresh_in_progress_until IS 'Lock TTL - if set to future timestamp, refresh is in progress';

-- Create an index on status for efficient filtering of active users
CREATE INDEX IF NOT EXISTS idx_fitbit_credentials_status ON public.fitbit_credentials(status);
