-- Create meals table
CREATE TABLE IF NOT EXISTS public.meals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_category TEXT NOT NULL CHECK (meal_category IN ('Breakfast', 'Lunch', 'Dinner', 'Snack')),
  description TEXT,
  image_url TEXT,
  logged_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create water_logs table
CREATE TABLE IF NOT EXISTS public.water_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  water_ml INTEGER,
  coffee_cups INTEGER,
  tea_cups INTEGER,
  soda_ml INTEGER,
  energy_drink_ml INTEGER,
  logged_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create daily_checkins table
CREATE TABLE IF NOT EXISTS public.daily_checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
  stress INTEGER NOT NULL CHECK (stress BETWEEN 1 AND 5),
  energy INTEGER NOT NULL CHECK (energy BETWEEN 1 AND 5),
  focus INTEGER NOT NULL CHECK (focus BETWEEN 1 AND 5),
  workload INTEGER NOT NULL CHECK (workload BETWEEN 1 AND 5),
  sleep_restfulness INTEGER NOT NULL CHECK (sleep_restfulness BETWEEN 1 AND 5),
  social_connectedness INTEGER NOT NULL CHECK (social_connectedness BETWEEN 1 AND 5),
  emotions TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, date)
);

-- Create streaks table (TODO: Implement streak calculation logic)
CREATE TABLE IF NOT EXISTS public.streaks (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  current_streak INTEGER DEFAULT 0 NOT NULL,
  longest_streak INTEGER DEFAULT 0 NOT NULL,
  last_activity_date DATE
);

-- Enable RLS on all tables
ALTER TABLE public.meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.water_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.streaks ENABLE ROW LEVEL SECURITY;

-- Meals policies
CREATE POLICY "Users can view their own meals"
  ON public.meals
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own meals"
  ON public.meals
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Water logs policies
CREATE POLICY "Users can view their own water logs"
  ON public.water_logs
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own water logs"
  ON public.water_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Daily check-ins policies
CREATE POLICY "Users can view their own check-ins"
  ON public.daily_checkins
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own check-ins"
  ON public.daily_checkins
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Streaks policies
CREATE POLICY "Users can view their own streak"
  ON public.streaks
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own streak"
  ON public.streaks
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_meals_user_id_logged_at ON public.meals(user_id, logged_at DESC);
CREATE INDEX idx_water_logs_user_id_logged_at ON public.water_logs(user_id, logged_at DESC);
CREATE INDEX idx_daily_checkins_user_id_date ON public.daily_checkins(user_id, date DESC);
