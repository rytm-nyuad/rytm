// API Route for Journal (Guided Mode with LLM)
// POST /api/journal - Send message and get AI response
// THIN LAYER: Delegates all logic to JournalAgent
// src/app/api/journal/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { JournalAgent } from "@/llm-service/agents";
import { AgentContext } from "@/llm-service/types";

export const dynamic = 'force-dynamic';

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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // CHANGE: accept localDate + clientAt for backlogging
    const body = await req.json();
    const content: string = body.content;
    const mode = "guided" ; 
    const localDate = body.localDate;
    const clientAt: string | null = body.clientAt ?? null;   // ISO string for today (optional)

    if (!content || typeof content !== "string") {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    // Create agent context
    const context: AgentContext = {
      supabase,
      userId: user.id,
    };

    // Run agent (compute aiResponse + threadId)
    const agent = new JournalAgent();
    const result = await agent.run(
      {
        userId: user.id,
        content,
        mode, // "guided"
        localDate,
      },
      context
    );

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // CHANGE: determine localDate if not provided (fallback to "today in canonical tz")
    // We use refresh_daily_summary(user, NULL) only to get the computed local date,
    // then the log_journal_message_for_date will refresh again for that day.
    let effectiveLocalDate = localDate;
    if (!effectiveLocalDate) {
      const { data: todayRow, error: refreshErr } = await supabase.rpc("refresh_daily_summary", {
        p_user_id: user.id,
        p_target_date: null,
      });

      if (refreshErr || !todayRow?.date) {
        return NextResponse.json(
          { error: "Could not determine local date for journaling" },
          { status: 500 }
        );
      }

      effectiveLocalDate = todayRow.date; // YYYY-MM-DD
    }

    // CHANGE: store BOTH user + assistant messages via RPC so local_date is correct
    // (Assumes agent is NOT already inserting into journal_messages)
    const threadId = result.threadId;

    // user message
    const { data: okUser, error: rpcErrUser } = await supabase.rpc(
      "log_journal_message_for_date",
      {
        p_user_id: user.id,
        p_mode: "guided",
        p_role: "user",
        p_content: content,
        p_local_date: effectiveLocalDate,
        p_thread_id: threadId,
        p_at: clientAt, // if null => noon fallback
      }
    );

    if (rpcErrUser || okUser !== true) {
      return NextResponse.json(
        { error: "Failed to store user journal message" },
        { status: 500 }
      );
    }

    // assistant message
    const { data: okAi, error: rpcErrAi } = await supabase.rpc(
      "log_journal_message_for_date",
      {
        p_user_id: user.id,
        p_mode: "guided",
        p_role: "assistant",
        p_content: result.aiResponse ?? "",
        p_local_date: effectiveLocalDate,
        p_thread_id: threadId,
        // If clientAt exists, add a tiny offset to preserve ordering
        p_at: clientAt ? new Date(new Date(clientAt).getTime() + 1000).toISOString() : null,
      }
    );

    if (rpcErrAi || okAi !== true) {
      return NextResponse.json(
        { error: "Failed to store assistant journal message" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      response: result.aiResponse,
      threadId: result.threadId,
      message: result.message,
      metadata: result.metadata,
      localDate: effectiveLocalDate, // helpful for debugging UI/backlogging
    });
  } catch (error) {
    console.error("Journal API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
