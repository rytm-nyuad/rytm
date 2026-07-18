-- Enrich journal_summary2 for commitments / recurring topics / narrative summary
-- and add a rolling per-user journal context table for future conversational coach.

ALTER TABLE public.journal_summary2
  ADD COLUMN IF NOT EXISTS narrative_summary text,
  ADD COLUMN IF NOT EXISTS topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS commitments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recurring_topics jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.journal_summary2.narrative_summary IS
  'Short natural-language summary of what the user is going through that day.';
COMMENT ON COLUMN public.journal_summary2.topics IS
  'Topic labels mentioned that day (academic, relationships, travel, etc.).';
COMMENT ON COLUMN public.journal_summary2.commitments IS
  'Past/today/upcoming/ongoing commitments extracted from journal text.';
COMMENT ON COLUMN public.journal_summary2.recurring_topics IS
  'Topics the user frames as ongoing or repeatedly returning.';

CREATE TABLE IF NOT EXISTS public.user_journal_context2 (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  as_of_date date NOT NULL,
  narrative_arc text NOT NULL DEFAULT '',
  open_commitments jsonb NOT NULL DEFAULT '[]'::jsonb,
  recurring_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  recent_day_summaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_version text NOT NULL DEFAULT 'journal_context_v1',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_journal_context2_pkey PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_journal_context2_as_of_date
  ON public.user_journal_context2 (as_of_date);

COMMENT ON TABLE public.user_journal_context2 IS
  'Rolling cross-day journal context for conversational coaching.';

ALTER TABLE public.user_journal_context2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own journal context"
  ON public.user_journal_context2;

CREATE POLICY "Users can view their own journal context"
  ON public.user_journal_context2
  FOR SELECT
  USING (auth.uid() = user_id);
