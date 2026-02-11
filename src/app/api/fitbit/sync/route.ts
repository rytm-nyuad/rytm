// src/app/api/fitbit/sync/route.ts
//
// POST /api/fitbit/sync
// Syncs recent Fitbit daily data for the *currently authenticated* user.
//
// Body (optional JSON):
//   { "daysBack": number }   // e.g. 1 for "just today", 2 to also re-sync yesterday
//
// Response:
//   200 { ok: true, timezone, syncedDates, lastSyncedAt }
//   400 { ok: false, error: "FITBIT_NOT_CONNECTED" | "FITBIT_AUTH_REVOKED" | "BAD_REQUEST" }
//   401 { ok: false, error: "NOT_AUTHENTICATED" }
//   500 { ok: false, error: "UNKNOWN_ERROR" }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  syncFitbitDailyForUser,
  FitbitNotConnectedError,
  FitbitAuthRevokedError,
} from "@/lib/fitbit";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error("[Fitbit] Supabase auth error in /api/fitbit/sync:", authError);
  }

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "NOT_AUTHENTICATED" },
      { status: 401 }
    );
  }

  const appUserId = user.id;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // no body is also fine
  }

  let daysBack: number | undefined = undefined;
  if (body && typeof body.daysBack !== "undefined") {
    const n = Number(body.daysBack);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { ok: false, error: "BAD_REQUEST", message: "daysBack must be a positive number" },
        { status: 400 }
      );
    }
    // Clamp to a reasonable max so someone doesn't accidentally request 365 days.
    daysBack = Math.min(Math.max(1, Math.floor(n)), 7);
  }

  try {
    const result = await syncFitbitDailyForUser(supabase, appUserId, {
      daysBack,
    });

    return NextResponse.json(
      {
        ok: true,
        timezone: result.timezone,
        syncedDates: result.syncedDates,
        lastSyncedAt: result.lastSyncedAt,
      },
      { status: 200 }
    );
  } catch (err: any) {
    if (err instanceof FitbitNotConnectedError) {
      return NextResponse.json(
        { ok: false, error: "FITBIT_NOT_CONNECTED" },
        { status: 400 }
      );
    }

    if (err instanceof FitbitAuthRevokedError) {
      // Optional: you *could* also set daily_summary.has_fitbit=false here for today's date.
      return NextResponse.json(
        { ok: false, error: "FITBIT_AUTH_REVOKED" },
        { status: 400 }
      );
    }

    console.error("[Fitbit] Unexpected error in /api/fitbit/sync:", err);
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_ERROR" },
      { status: 500 }
    );
  }
}
