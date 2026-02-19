import { createClient } from "@supabase/supabase-js";

/**
 * Public Supabase client for unauthenticated queries.
 * Does not refresh sessions or manage cookies.
 * Use this for public pages that don't require authentication.
 */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}
