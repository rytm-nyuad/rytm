-- Migration: Add status tracking columns to whoop_credentials
-- This migration adds columns for handling WHOOP OAuth token refresh failures
-- and marking users who need to re-authenticate.

-- Add last_refresh_at column if it doesn't exist
ALTER TABLE public.whoop_credentials
ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMPTZ NULL;

-- Add last_refresh_error column if it doesn't exist
ALTER TABLE public.whoop_credentials
ADD COLUMN IF NOT EXISTS last_refresh_error TEXT NULL;

-- Add lock TTL column to prevent concurrent refresh attempts
-- Set to a future timestamp when refresh is in progress
-- NULL or past timestamp means no lock is held
ALTER TABLE public.whoop_credentials
ADD COLUMN IF NOT EXISTS refresh_in_progress_until TIMESTAMPTZ NULL;

-- Add comments to document the columns
COMMENT ON COLUMN public.whoop_credentials.status IS 'Connection status: active (valid tokens) or needs_reauth (user must reconnect)';
COMMENT ON COLUMN public.whoop_credentials.last_refresh_at IS 'Timestamp of last successful token refresh';
COMMENT ON COLUMN public.whoop_credentials.last_refresh_error IS 'Last refresh error message for debugging';
COMMENT ON COLUMN public.whoop_credentials.refresh_in_progress_until IS 'Lock TTL - if set to future timestamp, refresh is in progress';

-- Create an index on status for efficient filtering of active users
CREATE INDEX IF NOT EXISTS idx_whoop_credentials_status ON public.whoop_credentials(status);
