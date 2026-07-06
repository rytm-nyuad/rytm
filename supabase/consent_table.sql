-- Create consent_signatures table
CREATE TABLE IF NOT EXISTS public.consent_signatures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  signed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.consent_signatures ENABLE ROW LEVEL SECURITY;

-- Users can view their own consent signature
CREATE POLICY "Users can view their own consent signature"
  ON public.consent_signatures
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own consent signature (only once due to UNIQUE constraint)
CREATE POLICY "Users can insert their own consent signature"
  ON public.consent_signatures
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX idx_consent_signatures_user_id ON public.consent_signatures(user_id);
CREATE INDEX idx_consent_signatures_email ON public.consent_signatures(user_email);
