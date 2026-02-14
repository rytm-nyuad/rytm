import { createPublicClient } from "@/lib/supabase/public";
import { createClient as createServerClient } from "@/lib/supabase/server";

// ── Types ──────────────────────────────────────────────
export interface Pulse {
  id: string;
  pulse_number: number;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  content_markdown: string;
  cover_image_url: string | null;
  tags: string[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author_user_id: string | null;
  author_name: string | null;
}

export interface PulsePreview {
  id: string;
  pulse_number: number;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  cover_image_url: string | null;
  tags: string[];
  published_at: string | null;
  author_name: string | null;
}

export interface AdjacentPulses {
  previous: { slug: string; title: string; pulse_number: number } | null;
  next: { slug: string; title: string; pulse_number: number } | null;
}

// ── Public queries (server-side, using anon key + RLS) ──

export async function getPublishedPulses(): Promise<PulsePreview[]> {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from("pulses")
    .select(
      "id, pulse_number, slug, title, subtitle, excerpt, cover_image_url, tags, published_at, author_name"
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false });

  if (error) {
    console.error("Error fetching pulses:", error);
    return [];
  }

  return (data as PulsePreview[]) ?? [];
}

export async function getPulseBySlug(slug: string): Promise<Pulse | null> {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from("pulses")
    .select("*")
    .eq("slug", slug)
    .eq("is_published", true)
    .single();

  if (error) {
    return null;
  }

  return data as Pulse;
}

export async function getAdjacentPulses(
  pulseNumber: number
): Promise<AdjacentPulses> {
  const supabase = createPublicClient();

  // Previous pulse (lower pulse_number, published)
  const { data: prev } = await supabase
    .from("pulses")
    .select("slug, title, pulse_number")
    .eq("is_published", true)
    .lt("pulse_number", pulseNumber)
    .order("pulse_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Next pulse (higher pulse_number, published)
  const { data: next } = await supabase
    .from("pulses")
    .select("slug, title, pulse_number")
    .eq("is_published", true)
    .gt("pulse_number", pulseNumber)
    .order("pulse_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    previous: prev ?? null,
    next: next ?? null,
  };
}

// ── Admin queries (server-side, require auth) ──

export async function getAllPulsesAdmin(): Promise<Pulse[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("pulses")
    .select("*")
    .order("pulse_number", { ascending: false });

  if (error) {
    console.error("Error fetching all pulses (admin):", error);
    return [];
  }

  return (data as Pulse[]) ?? [];
}

export async function isUserPulseAdmin(): Promise<boolean> {
  const supabase = await createServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return false;

  const { data } = await supabase
    .from("pulse_admins")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  return !!data;
}
