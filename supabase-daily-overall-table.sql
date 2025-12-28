-- Create daily_overall table for morning gate question
CREATE TABLE IF NOT EXISTS public.daily_overall (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  uid UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  overall_score INTEGER NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(uid, date)
);

-- Enable RLS
ALTER TABLE public.daily_overall ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own daily_overall"
  ON public.daily_overall
  FOR SELECT
  USING (auth.uid() = uid);

CREATE POLICY "Users can insert their own daily_overall"
  ON public.daily_overall
  FOR INSERT
  WITH CHECK (auth.uid() = uid);

CREATE POLICY "Users can update their own daily_overall"
  ON public.daily_overall
  FOR UPDATE
  USING (auth.uid() = uid);
