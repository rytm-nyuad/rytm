// src/lib/time.ts
import type { SupabaseClient } from "@supabase/supabase-js";

const tzCache = new Map<string, { expiresAt: number; tz: string }>();
const TZ_TTL_MS = 60_000; // 1 min is fine


export type LocalDateString = string; // "YYYY-MM-DD"

/**
 * Format a JS Date into YYYY-MM-DD in the provided IANA timezone.
 * Uses en-CA to reliably produce ISO-like date.
 */
export function formatLocalDate(d: Date, tz: string): LocalDateString {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Compare two Dates by local day in a given timezone.
 */
export function isSameLocalDay(a: Date, b: Date, tz: string): boolean {
  return formatLocalDate(a, tz) === formatLocalDate(b, tz);
}

/**
 * Best-effort browser timezone detection.
 * NOTE: This is not canonical; only use as fallback.
 */
export function getBrowserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Parse "HH:MM" (24h) into hours/minutes.
 */
export function parseHHMM(time: string): { h: number; m: number } | null {
  const t = time.trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * Parse "hh:mm AM/PM" into 24h hours/minutes.
 * Accepts examples: "06:02 PM", "6:02pm", "12:00 AM"
 */
export function parseHHMMA(time: string): { h: number; m: number } | null {
  const t = time.trim().toUpperCase();
  const m = /^(\d{1,2}):([0-5]\d)\s*(AM|PM)$/.exec(t);
  if (!m) return null;

  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const ampm = m[3];

  if (hours < 1 || hours > 12) return null;

  if (ampm === "AM") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }

  return { h: hours, m: minutes };
}

/**
 * Get the local hour (0–23) in a given IANA timezone for a given Date (default now).
 * Uses formatToParts to avoid locale parsing issues.
 */
export function getLocalHourInTimeZone(tz: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const hour = Number(hourStr);
  return Number.isFinite(hour) ? hour : 0;
}


export async function getCanonicalTimeZone(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const now = Date.now();
  const cached = tzCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.tz;

  // 1) Fitbit timezone
  const { data: fitbit, error: fitbitErr } = await supabase
    .from("fitbit_profile")
    .select("user_timezone")
    .eq("app_user_id", userId)
    .maybeSingle();

  if (!fitbitErr && fitbit?.user_timezone) {
    tzCache.set(userId, { expiresAt: now + TZ_TTL_MS, tz: fitbit.user_timezone });
    return fitbit.user_timezone;
  }

  // 2) profiles.timezone if present
  try {
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle();

    const profileTz = !profileErr && profile?.timezone ? profile.timezone : null;
    if (profileTz) {
      tzCache.set(userId, { expiresAt: now + TZ_TTL_MS, tz: profileTz });
      return profileTz;
    }
  } catch {
    // column may not exist
  }

  // 3) browser fallback + persist
  const browserTz = getBrowserTimeZone();
  await supabase.rpc("ensure_profile_timezone", {
    p_user_id: userId,
    p_timezone: browserTz,
  });

  tzCache.set(userId, { expiresAt: now + TZ_TTL_MS, tz: browserTz });
  return browserTz;
}

export function invalidateCanonicalTimeZone(userId: string) {
  tzCache.delete(userId);
}

// in src/lib/time.ts
/**
 * Format a JS Date into a user-facing local date string (DD/MM/YYYY)
 * in the provided IANA timezone. Used for UI display (headers, labels).
 */
export function formatLocalDisplayDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export function normalizeToNoon(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(12, 0, 0, 0);
  return copy;
}
