-- Enable RLS on daily_overall table
ALTER TABLE public.daily_overall ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own daily_overall" ON public.daily_overall;
DROP POLICY IF EXISTS "Users can insert their own daily_overall" ON public.daily_overall;
DROP POLICY IF EXISTS "Users can update their own daily_overall" ON public.daily_overall;

-- Policy: Users can SELECT their own records
CREATE POLICY "Users can view their own daily_overall"
  ON public.daily_overall
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can INSERT their own records
CREATE POLICY "Users can insert their own daily_overall"
  ON public.daily_overall
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can UPDATE their own records
CREATE POLICY "Users can update their own daily_overall"
  ON public.daily_overall
  FOR UPDATE
  USING (auth.uid() = user_id);
