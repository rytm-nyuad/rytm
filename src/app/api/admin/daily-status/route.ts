import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  // 1) Validate auth session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) Validate admin
  const { data: adminRow } = await supabase
    .from("pulse_admins")
    .select("email")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  if (!adminRow) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3) Parse date param
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { error: "Missing or invalid date parameter (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  // 4) Use admin client to bypass RLS and left-join profiles + daily_summary
  const adminClient = createSupabaseAdminClient();

  // Get all profiles including is_study_participant
  const { data: profiles, error: profilesErr } = await adminClient
    .from("profiles")
    .select("user_id, first_name, last_name, email, timezone, is_study_participant");

  if (profilesErr) {
    return NextResponse.json(
      { error: "Failed to fetch profiles", details: profilesErr.message },
      { status: 500 }
    );
  }

  // Get daily_summary rows for the given date
  const { data: summaries, error: summErr } = await adminClient
    .from("daily_summary")
    .select(
      "user_id, date, has_overall, has_checkin, has_journal, has_meal, is_complete, streak_value, is_backlogged, updated_at"
    )
    .eq("date", dateParam);

  if (summErr) {
    return NextResponse.json(
      { error: "Failed to fetch daily_summary", details: summErr.message },
      { status: 500 }
    );
  }

  // Build a lookup map: user_id -> summary
  const summaryMap = new Map<string, (typeof summaries)[number]>();
  for (const s of summaries ?? []) {
    summaryMap.set(s.user_id, s);
  }

  // 5) Build rows with display_email fallback for the logged-in user
  const sessionUserId = user.id;
  const sessionEmail = user.email;
  const allProfiles = profiles ?? [];

  function buildRow(p: { user_id: string; first_name: string | null; last_name: string | null; email: string | null; timezone: string | null; is_study_participant: boolean | null }) {
    const s = summaryMap.get(p.user_id) ?? null;
    // Email fallback: if profiles.email is null and this is the session user, use auth email
    let displayEmail = p.email;
    if (!displayEmail && p.user_id === sessionUserId) {
      displayEmail = sessionEmail ?? null;
    }
    return {
      user_id: p.user_id,
      full_name: [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
      display_email: displayEmail,
      timezone: p.timezone,
      summary: s
        ? {
            has_overall: s.has_overall,
            has_checkin: s.has_checkin,
            has_journal: s.has_journal,
            has_meal: s.has_meal,
            is_complete: s.is_complete,
            streak_value: s.streak_value,
            is_backlogged: s.is_backlogged,
            updated_at: s.updated_at,
          }
        : null,
    };
  }

  // 6) Split into study participants vs others
  const study = allProfiles
    .filter((p) => p.is_study_participant === true)
    .map(buildRow);
  const others = allProfiles
    .filter((p) => p.is_study_participant !== true)
    .map(buildRow);

  return NextResponse.json({ date: dateParam, study, others });
}
