// src/lib/fitbit.ts
//
// Server-only helpers for syncing Fitbit daily data into Supabase.
//
// Assumptions:
// - Supabase schema matches the SQL you shared (fitbit_* tables + daily_summary).
// - fitbit_credentials has: app_user_id, fitbit_user_id, access_token, refresh_token,
//   scopes, status (text, e.g. 'ok'|'revoked'|'error'), last_synced_at (timestamptz).
// - daily_summary has has_fitbit boolean column.
// - time helpers exist in src/lib/time.ts as you pasted.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatLocalDate,
  normalizeToNoon,
  getCanonicalTimeZone,
  type LocalDateString,
} from "@/lib/time";

const FITBIT_API_BASE = "https://api.fitbit.com";
const FITBIT_TOKEN_URL = "https://api.fitbit.com/oauth2/token";

// --------------------
// Types & Error classes
// --------------------

type FitbitCredentialsRow = {
  app_user_id: string;
  fitbit_user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  scopes: string[] | null;
  status?: string | null; // 'ok' | 'revoked' | 'error' | null
  last_synced?: string | null; // NOTE: matches DB column `last_synced`
  updated_at?: string | null;
};

export class FitbitNotConnectedError extends Error {
  constructor(message = "Fitbit not connected for this user.") {
    super(message);
    this.name = "FitbitNotConnectedError";
  }
}

export class FitbitAuthRevokedError extends Error {
  constructor(message = "Fitbit access has been revoked or refresh token is invalid.") {
    super(message);
    this.name = "FitbitAuthRevokedError";
  }
}

export class FitbitApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "FitbitApiError";
    this.status = status;
  }
}

export class FitbitRateLimitError extends Error {
  retryAfter?: number; // seconds until reset, if provided by Fitbit
  constructor(message = "Fitbit API rate limit exceeded (429).", retryAfter?: number) {
    super(message);
    this.name = "FitbitRateLimitError";
    this.retryAfter = retryAfter;
  }
}

// --------------------
// Small utilities
// --------------------

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Generate a list of local date strings (YYYY-MM-DD) in the user's timezone,
 * going back `daysBack` days from `now`.
 *
 * Example: daysBack=2 -> [today, yesterday] in that timezone.
 */
function makeUserLocalDateRange(now: Date, tz: string, daysBack: number): LocalDateString[] {
  const dates: LocalDateString[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < daysBack; offset++) {
    const d = normalizeToNoon(addDays(now, -offset));
    const localDate = formatLocalDate(d, tz);
    if (!seen.has(localDate)) {
      seen.add(localDate);
      dates.push(localDate);
    }
  }

  return dates;
}

function fitbitUserSegment(creds: FitbitCredentialsRow): string {
  return encodeURIComponent(creds.fitbit_user_id);
}

// --------------------
// Credentials helpers
// --------------------

async function getFitbitCredentialsForUser(
  supabase: SupabaseClient,
  appUserId: string
): Promise<FitbitCredentialsRow> {
  const { data, error } = await supabase
    .from("fitbit_credentials")
    .select("*")
    .eq("app_user_id", appUserId)
    .maybeSingle<FitbitCredentialsRow>();

  if (error) {
    throw new FitbitApiError(`Error reading fitbit_credentials: ${error.message}`);
  }

  if (!data || !data.access_token || !data.refresh_token) {
    throw new FitbitNotConnectedError();
  }

  if (data.status === "revoked") {
    // We already know this connection is broken.
    throw new FitbitAuthRevokedError();
  }

  return data;
}

async function refreshFitbitAccessToken(
  supabase: SupabaseClient,
  creds: FitbitCredentialsRow
): Promise<FitbitCredentialsRow> {
  const CLIENT_ID = process.env.FITBIT_CLIENT_ID!;
  const CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET!;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new FitbitApiError("Missing FITBIT_CLIENT_ID or FITBIT_CLIENT_SECRET env vars.");
  }

  if (!creds.refresh_token) {
    throw new FitbitAuthRevokedError("Missing refresh token for Fitbit user.");
  }

  const basicAuthToken = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: creds.refresh_token,
    client_id: CLIENT_ID,
  });

  const res = await fetch(FITBIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuthToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const json = await res.json().catch(() => ({} as any));

  if (!res.ok) {
    // Fitbit uses invalid_grant when the refresh token is revoked/expired.
    const errorType = json?.errors?.[0]?.errorType;
    if (errorType === "invalid_grant") {
      // Mark as revoked in DB.
      await supabase
        .from("fitbit_credentials")
        .update({
          status: "revoked",
          access_token: null,
          refresh_token: null,
          updated_at: new Date().toISOString(),
        })
        .eq("app_user_id", creds.app_user_id);

      throw new FitbitAuthRevokedError("Fitbit refresh token invalid_grant.");
    }

    throw new FitbitApiError(
      `Failed to refresh Fitbit token: ${JSON.stringify(json)}`,
      res.status
    );
  }

  const newAccessToken: string = json.access_token;
  const newRefreshToken: string = json.refresh_token;
  const fitbitUserId: string = json.user_id ?? creds.fitbit_user_id;

  const updatedRow: FitbitCredentialsRow = {
    ...creds,
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    fitbit_user_id: fitbitUserId,
    status: "ok",
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("fitbit_credentials")
    .update(updatedRow)
    .eq("app_user_id", creds.app_user_id);

  if (error) {
    throw new FitbitApiError(
      `Failed to update fitbit_credentials after refresh: ${error.message}`
    );
  }

  return updatedRow;
}

// --------------------
// Core Fitbit fetch wrapper
// --------------------

interface FitbitFetchArgs {
  supabase: SupabaseClient;
  creds: FitbitCredentialsRow;
  path: string; // e.g. "/1/user/{userId}/hrv/date/2026-02-10.json"
  query?: Record<string, string | number | boolean | undefined>;
  allow404?: boolean; // some beta/premium endpoints may not exist; treat as "no data"
}

/**
 * Make a single Fitbit API request, auto-refreshing tokens if needed.
 * Returns parsed JSON, or null if allow404 and endpoint is missing / 404/204.
 */
async function fitbitFetchJson({
  supabase,
  creds,
  path,
  query,
  allow404 = false,
}: FitbitFetchArgs): Promise<any | null> {
  let currentCreds = creds;

  const makeUrl = () => {
    const url = new URL(FITBIT_API_BASE + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }
    return url.toString();
  };

  const doRequest = async (accessToken: string | null) => {
    if (!accessToken) {
      throw new FitbitAuthRevokedError("No access token available.");
    }
    const url = makeUrl();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      console.error("[Fitbit] Failed to parse JSON", {
        path,
        status: res.status,
        snippet: text.slice(0, 400),
      });
    }

    if (allow404 && (res.status === 404 || res.status === 204)) {
      console.warn("[Fitbit] allow404 true, treating as no data", { path, status: res.status });
      return { json: null, status: res.status };
    }

    if (res.status === 204) {
      return { json: null, status: res.status };
    }

    if (!res.ok) {
      console.error("[Fitbit] Fitbit API error", {
        path,
        status: res.status,
        body: text.slice(0, 400),
      });
      return { json, status: res.status };
    }

    return { json, status: res.status };
  };

  // First try with current access token.
  let { json, status } = await doRequest(currentCreds.access_token);

  if (status === 401 || status === 403) {
    // Try refreshing, then one retry.
    currentCreds = await refreshFitbitAccessToken(supabase, currentCreds);
    ({ json, status } = await doRequest(currentCreds.access_token));
  }

  if ((status === 404 || status === 204) && allow404) {
    return null;
  }

  if (status === 429) {
    // Parse Retry-After if Fitbit includes it (they sometimes do in headers,
    // but since we only have the parsed JSON here we use a safe default).
    const retryAfter = typeof json?.['retry-after'] === 'number' ? json['retry-after'] : undefined;
    throw new FitbitRateLimitError(
      `Fitbit rate limit hit for ${path}`,
      retryAfter
    );
  }

  if (status && status >= 400) {
    throw new FitbitApiError(
      `Fitbit API error for ${path}: status=${status}, body=${JSON.stringify(json)}`,
      status
    );
  }

  return json;
}

// --------------------
// Per-metric fetchers (per-day)
// --------------------

interface SleepDailyRow {
  app_user_id: string;
  date: LocalDateString;
  sleep_duration_ms: number | null;
  sleep_start_time: string | null; // timestamptz
  sleep_end_time: string | null;
  minutes_asleep: number | null;
  minutes_awake: number | null;
  time_in_bed: number | null;
  deep_minutes: number | null;
  light_minutes: number | null;
  rem_minutes: number | null;
  wake_minutes: number | null;
  sleep_score: number | null;
  created_at?: string;
}

async function fetchDailySleep(
  supabase: SupabaseClient,
  creds: FitbitCredentialsRow,
  appUserId: string,
  dateLocal: LocalDateString
): Promise<SleepDailyRow | null> {
  const userSeg = fitbitUserSegment(creds);
  const data = await fitbitFetchJson({
    supabase,
    creds,
    // Matches your Python PoC:
    // https://api.fitbit.com/1.2/user/{USER_ID}/sleep/date/{DATE}.json
    path: `/1.2/user/${userSeg}/sleep/date/${dateLocal}.json`,
  });

  const sleepList: any[] = data?.sleep ?? [];
  if (!sleepList.length) {
    return null;
  }

  const mainSleeps = sleepList.filter((s) => s.isMainSleep);
  const record = mainSleeps[0] ?? sleepList[0];

  const levelsSummary = record?.levels?.summary ?? {};
  const deep = levelsSummary.deep ?? {};
  const light = levelsSummary.light ?? {};
  const rem = levelsSummary.rem ?? {};
  const wake = levelsSummary.wake ?? {};

  return {
    app_user_id: appUserId,
    date: dateLocal,
    sleep_duration_ms: record.duration ?? null,
    sleep_start_time: record.startTime ?? null,
    sleep_end_time: record.endTime ?? null,
    minutes_asleep: record.minutesAsleep ?? null,
    minutes_awake: record.minutesAwake ?? null,
    time_in_bed: record.timeInBed ?? null,
    deep_minutes: deep.minutes ?? null,
    light_minutes: light.minutes ?? null,
    rem_minutes: rem.minutes ?? null,
    wake_minutes: wake.minutes ?? null,
    sleep_score: record.sleepScore ?? null,
    created_at: new Date().toISOString(),
  };
}

interface HRVDailyRow {
  app_user_id: string;
  date: LocalDateString;
  hrv_daily_rmssd: number | null;
  hrv_deep_rmssd: number | null;
  created_at?: string;
}

async function fetchDailyHRV(
  supabase: SupabaseClient,
  creds: FitbitCredentialsRow,
  appUserId: string,
  dateLocal: LocalDateString
): Promise<HRVDailyRow | null> {
  const userSeg = fitbitUserSegment(creds);
  const data = await fitbitFetchJson({
    supabase,
    creds,
    // Python PoC: https://api.fitbit.com/1/user/{USER_ID}/hrv/date/{DATE}.json
    path: `/1/user/${userSeg}/hrv/date/${dateLocal}.json`,
    allow404: true, // HRV may not be available for all devices
  });

  if (!data) return null;

  const list: any[] = data?.hrv ?? [];
  if (!list.length) {
    return null;
  }

  const value = list[0]?.value ?? {};

  return {
    app_user_id: appUserId,
    date: dateLocal,
    hrv_daily_rmssd: value.dailyRmssd ?? null,
    hrv_deep_rmssd: value.deepRmssd ?? null,
    created_at: new Date().toISOString(),
  };
}

interface Spo2DailyRow {
  app_user_id: string;
  date: LocalDateString;
  spo2_avg: number | null;
  spo2_min: number | null;
  spo2_max: number | null;
  created_at?: string;
}

async function fetchDailySpo2(
  supabase: SupabaseClient,
  creds: FitbitCredentialsRow,
  appUserId: string,
  dateLocal: LocalDateString
): Promise<Spo2DailyRow | null> {
  const userSeg = fitbitUserSegment(creds);
  const data = await fitbitFetchJson({
    supabase,
    creds,
    // Python PoC: https://api.fitbit.com/1/user/{USER_ID}/spo2/date/{DATE}.json
    path: `/1/user/${userSeg}/spo2/date/${dateLocal}.json`,
    allow404: true, // SpO2 may be premium / device-dependent
  });

  if (!data) return null;

  const value = data?.value ?? {};
  const avg = value.avg ?? null;
  const min = value.min ?? null;
  const max = value.max ?? null;

  if (avg === null && min === null && max === null) {
    return null;
  }

  return {
    app_user_id: appUserId,
    date: dateLocal,
    spo2_avg: avg,
    spo2_min: min,
    spo2_max: max,
    created_at: new Date().toISOString(),
  };
}

interface OvernightDailyRow {
  app_user_id: string;
  date: LocalDateString;
  oxygen_variation: number | null;
  blood_oxygen_avg: number | null;
  breathing_rate: number | null;
  skin_temp_relative: number | null;
  created_at?: string;
}

/**
 * Overnight row combines:
 * - blood_oxygen_avg & oxygen_variation from SpO2
 * - breathing_rate from /br
 * - skin_temp_relative from /temp/skin
 *
 * We accept an already-fetched SpO2 row to avoid multiple calls.
 */
async function fetchDailyOvernight(
  supabase: SupabaseClient,
  creds: FitbitCredentialsRow,
  appUserId: string,
  dateLocal: LocalDateString,
  spo2Row: Spo2DailyRow | null
): Promise<OvernightDailyRow | null> {
  const userSeg = fitbitUserSegment(creds);

  // Breathing rate
  const brData = await fitbitFetchJson({
    supabase,
    creds,
    // Python PoC: https://api.fitbit.com/1/user/{USER_ID}/br/date/{DATE}.json
    path: `/1/user/${userSeg}/br/date/${dateLocal}.json`,
    allow404: true,
  });

  const brList: any[] = brData?.br ?? [];
  let breathingRate: number | null = null;
  if (brList.length) {
    const v = brList[0]?.value;
    if (typeof v === "number") breathingRate = v;
    else if (v && typeof v.breathingRate === "number") breathingRate = v.breathingRate;
  }

  // Skin temperature
  const tempData = await fitbitFetchJson({
    supabase,
    creds,
    // Python PoC: https://api.fitbit.com/1/user/{USER_ID}/temp/skin/date/{DATE}.json
    path: `/1/user/${userSeg}/temp/skin/date/${dateLocal}.json`,
    allow404: true,
  });

  const tempList: any[] = tempData?.tempSkin ?? [];
  let skinTempRelative: number | null = null;
  if (tempList.length) {
    const v = tempList[0]?.value ?? {};
    if (typeof v.nightlyRelative === "number") skinTempRelative = v.nightlyRelative;
  }

  const spo2Avg = spo2Row?.spo2_avg ?? null;
  const spo2Min = spo2Row?.spo2_min ?? null;
  const spo2Max = spo2Row?.spo2_max ?? null;

  const oxygenVariation =
    spo2Max !== null && spo2Min !== null ? spo2Max - spo2Min : null;

  if (
    spo2Avg === null &&
    oxygenVariation === null &&
    breathingRate === null &&
    skinTempRelative === null
  ) {
    // Truly no overnight data.
    return null;
  }

  return {
    app_user_id: appUserId,
    date: dateLocal,
    oxygen_variation: oxygenVariation,
    blood_oxygen_avg: spo2Avg,
    breathing_rate: breathingRate,
    skin_temp_relative: skinTempRelative,
    created_at: new Date().toISOString(),
  };
}

interface ActivityDailyRow {
  app_user_id: string;
  date: LocalDateString;
  steps: number | null;
  energy_burned_calories_out: number | null;
  activity_calories: number | null;
  bmr_calories: number | null;
  distance_total_km: number | null;
  lightly_active_minutes: number | null;
  fairly_active_minutes: number | null;
  very_active_minutes: number | null;
  sedentary_minutes: number | null;
  resting_heart_rate: number | null;
  created_at?: string;
}

async function fetchDailyActivity(
  supabase: SupabaseClient,
  creds: FitbitCredentialsRow,
  appUserId: string,
  dateLocal: LocalDateString
): Promise<ActivityDailyRow | null> {
  const userSeg = fitbitUserSegment(creds);
  const data = await fitbitFetchJson({
    supabase,
    creds,
    // Python PoC: https://api.fitbit.com/1/user/{USER_ID}/activities/date/{DATE}.json
    path: `/1/user/${userSeg}/activities/date/${dateLocal}.json`,
  });

  const summary = data?.summary ?? {};
  const distances: any[] = summary.distances ?? [];

  let totalDistance: number | null = null;
  if (Array.isArray(distances) && distances.length) {
    const totalEntry = distances.find((d) => d.activity === "total");
    if (totalEntry && typeof totalEntry.distance === "number") {
      totalDistance = totalEntry.distance;
    } else if (typeof distances[0].distance === "number") {
      totalDistance = distances[0].distance;
    }
  }

  const steps = summary.steps ?? null;
  const caloriesOut = summary.caloriesOut ?? null;
  const activityCalories = summary.activityCalories ?? null;
  const bmrCalories = summary.caloriesBMR ?? null;
  const lightlyActiveMinutes = summary.lightlyActiveMinutes ?? null;
  const fairlyActiveMinutes = summary.fairlyActiveMinutes ?? null;
  const veryActiveMinutes = summary.veryActiveMinutes ?? null;
  const sedentaryMinutes = summary.sedentaryMinutes ?? null;
  const restingHeartRate = summary.restingHeartRate ?? null;

  const allNull =
    steps === null &&
    caloriesOut === null &&
    activityCalories === null &&
    bmrCalories === null &&
    totalDistance === null &&
    lightlyActiveMinutes === null &&
    fairlyActiveMinutes === null &&
    veryActiveMinutes === null &&
    sedentaryMinutes === null &&
    restingHeartRate === null;

  if (allNull) return null;

  return {
    app_user_id: appUserId,
    date: dateLocal,
    steps,
    energy_burned_calories_out: caloriesOut,
    activity_calories: activityCalories,
    bmr_calories: bmrCalories,
    distance_total_km: totalDistance,
    lightly_active_minutes: lightlyActiveMinutes,
    fairly_active_minutes: fairlyActiveMinutes,
    very_active_minutes: veryActiveMinutes,
    sedentary_minutes: sedentaryMinutes,
    resting_heart_rate: restingHeartRate,
    created_at: new Date().toISOString(),
  };
}

// --------------------
// Public entrypoint: syncFitbitDailyForUser
// --------------------

export interface SyncFitbitResult {
  timezone: string;
  syncedDates: LocalDateString[];
  lastSyncedAt: string;
}

/**
 * Main public function:
 * - figures out user's canonical timezone
 * - determines the last N local dates to sync
 * - fetches daily metrics for each date
 * - upserts into fitbit_*_daily tables
 * - updates daily_summary.has_fitbit=true on days where we got any data
 * - updates fitbit_credentials.last_synced_at + status='ok'
 *
 * This is designed to be called from:
 * - an API route (e.g. /api/fitbit/sync) for a single user
 * - or a cron/Job that loops over many users and calls this per-user.
 */
export async function syncFitbitDailyForUser(
  supabase: SupabaseClient,
  appUserId: string,
  opts?: { daysBack?: number; now?: Date }
): Promise<SyncFitbitResult> {
  // daysBack is still fully configurable for multi-day / backlog syncs.
  const daysBack = opts?.daysBack && opts.daysBack > 0 ? opts.daysBack : 2;
  const now = opts?.now ?? new Date();

  // 1) Get canonical user timezone (Fitbit -> profiles -> browser fallback).
  const tz = await getCanonicalTimeZone(supabase, appUserId);

  // 2) Determine local dates to sync.
  const dates = makeUserLocalDateRange(now, tz, daysBack);

  // 3) Get current Fitbit credentials row.
  let creds = await getFitbitCredentialsForUser(supabase, appUserId);

  const syncedDates: LocalDateString[] = [];

  for (const dateLocal of dates) {
    let hadAnyMetric = false;

    try {
      // Sleep
      const sleepRow = await fetchDailySleep(supabase, creds, appUserId, dateLocal);
      if (sleepRow) {
        const { error } = await supabase
          .from("fitbit_sleep_daily")
          .upsert(sleepRow, { onConflict: "app_user_id,date" });
        if (error) {
          console.error("[Fitbit] Error upserting fitbit_sleep_daily:", error);
        } else {
          hadAnyMetric = true;
        }
      }

      // HRV
      const hrvRow = await fetchDailyHRV(supabase, creds, appUserId, dateLocal);
      if (hrvRow) {
        const { error } = await supabase
          .from("fitbit_hrv_daily")
          .upsert(hrvRow, { onConflict: "app_user_id,date" });
        if (error) {
          console.error("[Fitbit] Error upserting fitbit_hrv_daily:", error);
        } else {
          hadAnyMetric = true;
        }
      }

      // SpO2
      const spo2Row = await fetchDailySpo2(supabase, creds, appUserId, dateLocal);
      if (spo2Row) {
        const { error } = await supabase
          .from("fitbit_spo2_daily")
          .upsert(spo2Row, { onConflict: "app_user_id,date" });
        if (error) {
          console.error("[Fitbit] Error upserting fitbit_spo2_daily:", error);
        } else {
          hadAnyMetric = true;
        }
      }

      // Overnight (uses spo2Row for oxygen-related fields)
      const overnightRow = await fetchDailyOvernight(
        supabase,
        creds,
        appUserId,
        dateLocal,
        spo2Row ?? null
      );
      if (overnightRow) {
        const { error } = await supabase
          .from("fitbit_overnight_daily")
          .upsert(overnightRow, { onConflict: "app_user_id,date" });
        if (error) {
          console.error("[Fitbit] Error upserting fitbit_overnight_daily:", error);
        } else {
          hadAnyMetric = true;
        }
      }

      // Activity
      const activityRow = await fetchDailyActivity(
        supabase,
        creds,
        appUserId,
        dateLocal
      );
      if (activityRow) {
        const { error } = await supabase
          .from("fitbit_activity_daily")
          .upsert(activityRow, { onConflict: "app_user_id,date" });
        if (error) {
          console.error("[Fitbit] Error upserting fitbit_activity_daily:", error);
        } else {
          hadAnyMetric = true;
        }
      }

      // Update daily_summary.has_fitbit for this date.
      if (hadAnyMetric) {
        const { error } = await supabase.from("daily_summary").upsert(
          {
            user_id: appUserId,
            date: dateLocal,
            timezone: tz,
            has_fitbit: true,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,date",
          }
        );

        if (error) {
          console.error("[Fitbit] Error updating daily_summary.has_fitbit:", error);
        }
      }

      if (hadAnyMetric) {
        syncedDates.push(dateLocal);
      }
    } catch (err) {
      // Important: if we hit revoked auth, bubble up immediately so caller can
      // mark has_fitbit=false etc. (API route should catch this explicitly).
      if (err instanceof FitbitAuthRevokedError) {
        throw err;
      }
      if (err instanceof FitbitNotConnectedError) {
        throw err;
      }
      // Rate limit: no point continuing further dates in this sync run.
      if (err instanceof FitbitRateLimitError) {
        console.warn(`[Fitbit] Rate limited on ${dateLocal}. Aborting sync run.`, {
          retryAfter: err.retryAfter,
        });
        throw err;
      }
      console.error(`[Fitbit] Error syncing for date ${dateLocal}:`, err);
      // For other errors, we just log and continue with other dates.
    }
  }

  const lastSyncedAtIso = new Date().toISOString();

  // Update credentials last_synced_at + status.
  const { error: credsUpdateError } = await supabase
    .from("fitbit_credentials")
    .update({
      status: "ok",
      last_synced_at: lastSyncedAtIso, // <-- matches DB + TopNav
      updated_at: lastSyncedAtIso,
    })
    .eq("app_user_id", appUserId);

  if (credsUpdateError) {
    console.error("[Fitbit] Error updating fitbit_credentials.last_synced:", credsUpdateError);
  }

  return {
    timezone: tz,
    syncedDates,
    lastSyncedAt: lastSyncedAtIso,
  };
}
