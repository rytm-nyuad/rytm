import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
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

  // 3) Parse optional date from body
  let targetDate: string;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      targetDate = body.date;
    } else {
      // Yesterday in Asia/Dubai
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })
      );
      now.setDate(now.getDate() - 1);
      targetDate = now.toISOString().split("T")[0];
    }
  } catch {
    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })
    );
    now.setDate(now.getDate() - 1);
    targetDate = now.toISOString().split("T")[0];
  }

  // 4) Perform upsert
  const adminClient = createSupabaseAdminClient();

  const { data: profiles, error: profilesErr } = await adminClient
    .from("profiles")
    .select("user_id, timezone");

  if (profilesErr) {
    return NextResponse.json(
      { error: "Failed to fetch profiles", details: profilesErr.message },
      { status: 500 }
    );
  }

  const rows = (profiles ?? []).map((p) => ({
    user_id: p.user_id,
    date: targetDate,
    timezone: p.timezone || "UTC",
  }));

  const { error: upsertErr, count } = await adminClient
    .from("daily_summary")
    .upsert(rows, { onConflict: "user_id,date", ignoreDuplicates: true, count: "exact" });

  if (upsertErr) {
    return NextResponse.json(
      { error: "Upsert failed", details: upsertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    date: targetDate,
    participants_count: rows.length,
    upserted_count: count ?? rows.length,
  });
}
