import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueForwardRecomputeFromChangedDate } from "@/lib/overall-submission-workflows";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const changedLocalDate =
      typeof body.changedLocalDate === "string" ? body.changedLocalDate : null;
    const semantic =
      body.semantic === "submission" ? "submission" : body.semantic === "source" ? "source" : null;

    if (!changedLocalDate || !/^\d{4}-\d{2}-\d{2}$/.test(changedLocalDate) || !semantic) {
      return NextResponse.json(
        { error: "changedLocalDate (YYYY-MM-DD) and semantic ('source' | 'submission') are required" },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const result = await queueForwardRecomputeFromChangedDate({
      userId: user.id,
      changedLocalDate,
      semantic,
      supabaseAdmin,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[recompute-forward] route error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
