-- Add missing updated_at column to coach_threads if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'coach_threads' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.coach_threads ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now() NOT NULL;
  END IF;
END $$;

-- Enable RLS (safe to run even if already enabled)
ALTER TABLE public.coach_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own coach threads" ON public.coach_threads;
DROP POLICY IF EXISTS "Users can create their own coach threads" ON public.coach_threads;
DROP POLICY IF EXISTS "Users can update their own coach threads" ON public.coach_threads;
DROP POLICY IF EXISTS "Users can delete their own coach threads" ON public.coach_threads;
DROP POLICY IF EXISTS "Users can view messages from their threads" ON public.coach_messages;
DROP POLICY IF EXISTS "Users can create messages in their threads" ON public.coach_messages;

-- RLS Policies for coach_threads
CREATE POLICY "Users can view their own coach threads"
  ON public.coach_threads FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own coach threads"
  ON public.coach_threads FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own coach threads"
  ON public.coach_threads FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own coach threads"
  ON public.coach_threads FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for coach_messages
CREATE POLICY "Users can view messages from their threads"
  ON public.coach_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.coach_threads
      WHERE coach_threads.id = coach_messages.thread_id
      AND coach_threads.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create messages in their threads"
  ON public.coach_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.coach_threads
      WHERE coach_threads.id = coach_messages.thread_id
      AND coach_threads.user_id = auth.uid()
    )
  );

-- Create indexes for better performance (if not exists)
CREATE INDEX IF NOT EXISTS idx_coach_threads_user_id ON public.coach_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_coach_threads_updated_at ON public.coach_threads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_messages_thread_id ON public.coach_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_coach_messages_created_at ON public.coach_messages(created_at);
