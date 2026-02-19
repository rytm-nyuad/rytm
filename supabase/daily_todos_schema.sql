-- ============================================================
-- daily_todos — per-day to-do list for each user
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_todos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         date        NOT NULL,                       -- local calendar day
  text         text        NOT NULL CHECK (char_length(trim(text)) > 0),
  is_completed boolean     NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Composite index for the primary query pattern
CREATE INDEX IF NOT EXISTS idx_daily_todos_user_date
  ON daily_todos (user_id, date, is_completed, created_at);

-- ============================================================
-- RLS — users may only touch their own rows
-- ============================================================
ALTER TABLE daily_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own todos"
  ON daily_todos FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own todos"
  ON daily_todos FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own todos"
  ON daily_todos FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own todos"
  ON daily_todos FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- Trigger: auto-update updated_at on every UPDATE
-- ============================================================
CREATE OR REPLACE FUNCTION update_daily_todos_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_todos_updated_at
  BEFORE UPDATE ON daily_todos
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_todos_updated_at();
