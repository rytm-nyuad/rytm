import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import ParticipantsClient from "./ParticipantsClient";

export const dynamic = "force-dynamic";

function getYesterdayDubai(): string {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })
  );
  now.setDate(now.getDate() - 1);
  return now.toISOString().split("T")[0];
}

export default async function AdminParticipantsPage() {
  const yesterday = getYesterdayDubai();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Admin guard is already handled by layout, but fetch initial data server-side
  if (!user?.email) return null;

  const sessionUserId = user.id;
  const sessionEmail = user.email;

  const adminClient = createSupabaseAdminClient();

  const { data: profiles } = await adminClient
    .from("profiles")
    .select("user_id, first_name, last_name, email, timezone, is_study_participant");

  const { data: summaries } = await adminClient
    .from("daily_summary")
    .select(
      "user_id, date, has_overall, has_checkin, has_journal, has_meal, is_complete, streak_value, is_backlogged, updated_at"
    )
    .eq("date", yesterday);

  const summaryMap = new Map<string, NonNullable<typeof summaries>[number]>();
  for (const s of summaries ?? []) {
    summaryMap.set(s.user_id, s);
  }

  function buildRow(p: NonNullable<typeof profiles>[number]) {
    const s = summaryMap.get(p.user_id) ?? null;
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

  const study = (profiles ?? [])
    .filter((p) => p.is_study_participant === true)
    .map(buildRow);
  const others = (profiles ?? [])
    .filter((p) => p.is_study_participant !== true)
    .map(buildRow);

  return (
    <ParticipantsClient
      initialDate={yesterday}
      initialStudy={study}
      initialOthers={others}
    />
  );
}
