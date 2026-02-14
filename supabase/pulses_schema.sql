-- ============================================================
-- RYTM Pulses — Blog Schema
-- ============================================================

-- 1. Main pulses table
CREATE TABLE IF NOT EXISTS public.pulses (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pulse_number    int         NOT NULL,
  slug            text        UNIQUE NOT NULL,
  title           text        NOT NULL,
  subtitle        text,
  excerpt         text,
  content_markdown text       NOT NULL,
  cover_image_url text,
  tags            text[]      NOT NULL DEFAULT '{}'::text[],
  is_published    boolean     NOT NULL DEFAULT false,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  author_user_id  uuid        REFERENCES auth.users(id),
  author_name     text
);

-- 2. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_pulses_slug ON public.pulses (slug);
CREATE INDEX IF NOT EXISTS idx_pulses_published ON public.pulses (is_published, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_pulses_tags ON public.pulses USING gin (tags);

-- 3. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.update_pulses_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pulses_updated_at ON public.pulses;
CREATE TRIGGER trg_pulses_updated_at
  BEFORE UPDATE ON public.pulses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_pulses_updated_at();

-- 4. Admin table
CREATE TABLE IF NOT EXISTS public.pulse_admins (
  email text PRIMARY KEY
);

-- Seed admin
INSERT INTO public.pulse_admins (email)
VALUES ('youssofsaleh7@gmail.com')
ON CONFLICT (email) DO NOTHING;

-- 5. Enable RLS
ALTER TABLE public.pulses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_admins ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies for pulses

-- Public read: anyone can read published pulses (no auth required)
DROP POLICY IF EXISTS "Public can read published pulses" ON public.pulses;
CREATE POLICY "Public can read published pulses"
  ON public.pulses
  FOR SELECT
  USING (is_published = true);

-- Admin full read: admins can read all pulses (including drafts)
DROP POLICY IF EXISTS "Admins can read all pulses" ON public.pulses;
CREATE POLICY "Admins can read all pulses"
  ON public.pulses
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pulse_admins
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Admin insert
DROP POLICY IF EXISTS "Admins can insert pulses" ON public.pulses;
CREATE POLICY "Admins can insert pulses"
  ON public.pulses
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pulse_admins
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Admin update
DROP POLICY IF EXISTS "Admins can update pulses" ON public.pulses;
CREATE POLICY "Admins can update pulses"
  ON public.pulses
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.pulse_admins
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- Admin delete
DROP POLICY IF EXISTS "Admins can delete pulses" ON public.pulses;
CREATE POLICY "Admins can delete pulses"
  ON public.pulses
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.pulse_admins
      WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- 7. RLS Policies for pulse_admins (only admins can read the admin list)
DROP POLICY IF EXISTS "Admins can read admin list" ON public.pulse_admins;
CREATE POLICY "Admins can read admin list"
  ON public.pulse_admins
  FOR SELECT
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );


-- ============================================================
-- SEED: Pulse #001
-- ============================================================

INSERT INTO public.pulses (
  pulse_number,
  slug,
  title,
  subtitle,
  excerpt,
  content_markdown,
  tags,
  is_published,
  published_at,
  author_name
) VALUES (
  1,
  'pulse-001-sleep-consistency',
  'Pulse #001 — Why Sleep Consistency Beats Sleep Duration',
  'Why 10–6 isn''t the same as 2–10, and how we turned it into a leaderboard metric.',
  'Most wearables optimize for sleep duration. We chose to optimize for regularity.',
  E'Every wearable on the market will tell you how long you slept. Seven hours and forty-two minutes. A green ring. A congratulatory notification. And yet, two people who each sleep exactly eight hours can have wildly different performance outcomes the next day. One wakes up sharp. The other drags through the morning in a fog.\n\nThe difference isn''t duration. It''s consistency.\n\n## The Duration Trap\n\nSleep science has spent decades fixating on total sleep time. The magic number — seven to nine hours — became gospel. Apps gamify it. Insurance companies incentivize it. But total sleep time is a blunt instrument. It tells you the *quantity* of sleep without revealing anything about its *alignment* with your biology.\n\nConsider two schedules:\n\n- **Person A** sleeps 10 PM to 6 AM every night\n- **Person B** sleeps 2 AM to 10 AM every night\n\nBoth get eight hours. But Person A wakes during the natural cortisol rise that primes alertness. Person B wakes well after their circadian system expected them to be active. Their melatonin is still clearing. Their core body temperature is still in its trough. They''re biologically mid-sleep even though the clock says morning is half over.\n\nDuration didn''t capture this. Timing did.\n\n## Circadian Alignment Is the Real Signal\n\nYour body doesn''t run on clock time. It runs on circadian time — a roughly 24-hour internal cycle governed by the suprachiasmatic nucleus, light exposure, and a cascade of hormonal rhythms. When your sleep window aligns with your circadian trough, you get deeper slow-wave sleep in the first half of the night and more REM in the second half. This architecture matters.\n\nWhen it''s misaligned — even by a couple of hours — sleep architecture degrades. You might still get eight hours total, but the ratio of restorative stages shifts. Slow-wave sleep gets compressed. REM gets fragmented. The downstream effects show up everywhere: reaction time, emotional regulation, appetite hormones, and even immune function.\n\nThis is why shift workers have elevated rates of metabolic disease despite sometimes sleeping adequate total hours. It''s not about how much. It''s about when.\n\n## Social Jetlag: The Silent Disruptor\n\nThere''s a name for the phenomenon where your social schedule conflicts with your biological one: social jetlag. It was coined by Till Roenneberg and it describes the discrepancy between your weekday and weekend sleep timing.\n\nIf you sleep midnight to 7 AM on weekdays but 2 AM to 11 AM on weekends, you''re essentially flying two time zones east every Monday morning. Your body never fully adjusts. The result is chronic low-grade circadian disruption — not dramatic enough to notice, but persistent enough to erode performance over weeks and months.\n\nMost people experience some degree of social jetlag. Few realize it''s happening. And almost no tracking tool surfaces it.\n\n## Why We Made Consistency the Leaderboard Metric\n\nWhen we designed RYTM''s leaderboard system, we had a choice: rank people by total sleep time, or rank them by something more meaningful. We chose consistency.\n\nThe leaderboard doesn''t reward who sleeps the longest. It rewards who maintains the most stable sleep-wake rhythm. This is a deliberate design decision rooted in the evidence.\n\nConsistency captures several things at once:\n\n- **Circadian alignment** — a regular schedule naturally syncs with your internal clock\n- **Social jetlag reduction** — weekday-to-weekend drift shows up as inconsistency\n- **Behavioral discipline** — keeping a steady rhythm requires the kind of intentional lifestyle design that compounds across every health dimension\n\nIt''s also more actionable than duration. You can''t always control how many hours you sleep (insomnia, kids, travel), but you can control *when* you go to bed and *when* you set your alarm. Consistency is within reach.\n\n## How RYTM Scores Consistency\n\nWithout going deep into the math, here''s the high-level approach:\n\nRYTM tracks your sleep-onset time and wake time over a rolling window. We compute the standard deviation of both. A perfectly consistent sleeper has near-zero deviation — they go to bed and wake up at roughly the same time every day.\n\nWe then combine onset and wake deviation into a single consistency score, normalized to a 0–100 scale. The scoring weights recent nights more heavily than older ones, so your score reflects your current rhythm, not the average of your entire history.\n\nBonuses are applied for streaks of consecutive consistent nights. Penalties are applied for large single-night deviations (the Monday-morning jetlag spike). The result is a score that''s intuitive, responsive, and directly tied to the behaviors that matter.\n\n## What''s Next\n\nConsistency is the foundation, but it''s only the first layer. We''re building toward baseline modeling — establishing each user''s personal circadian profile so we can detect deviations relative to *their* normal, not a population average.\n\nBeyond that, fatigue prediction. If we know your baseline rhythm, your recent deviation from it, and your daily context (travel, stress, training load), we can estimate when performance is likely to dip before it happens. Not a generic "you slept poorly" notification — a specific, personal forecast.\n\nSleep consistency is where it starts. But the goal has always been deeper: to build a system that understands your rhythm well enough to protect it.\n\n---\n\n*This is Pulse #001 — the first in a series of essays from the team building RYTM. We write about the science, modeling decisions, and design philosophy behind performance intelligence.*',
  ARRAY['sleep', 'circadian', 'leaderboard', 'modeling'],
  true,
  now(),
  'RYTM Team'
) ON CONFLICT (slug) DO NOTHING;
