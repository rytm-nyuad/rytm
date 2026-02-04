// API Route to create a new journal thread
// POST /api/journal/new-thread - Close current thread and create new one

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const dynamic = 'force-dynamic';
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );
    
    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;

    // Close current active GUIDED thread if exists
    await supabase
      .from("journal_threads")
      .update({ status: "closed" })
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("journal_type", "guided");

    // Create new guided thread
    const { data: newThread, error: createError } = await supabase
      .from("journal_threads")
      .insert({
        user_id: userId,
        title: `Guided Session`,
        status: "active",
        journal_type: "guided",
      })
      .select()
      .single();

    if (createError || !newThread) {
      return NextResponse.json(
        { error: "Failed to create new thread" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      threadId: newThread.id,
    });

  } catch (error) {
    console.error("New thread API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
