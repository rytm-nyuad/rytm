// ============================================================
// Supabase Admin Client (Service Role)
// ============================================================
// Creates a Supabase client using the SERVICE_ROLE_KEY which
// bypasses RLS. ONLY use in server contexts (API routes, scripts).
//
// DO NOT import this in client components.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _adminClient: SupabaseClient | null = null;

/**
 * Returns a Supabase client with service-role privileges.
 * Bypasses Row Level Security — use only server-side.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — required for admin operations');
  }

  _adminClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  return _adminClient;
}
