// API Route for Journal (Guided Mode with LLM)
// POST /api/journal - Send message and get AI response
// THIN LAYER: Delegates all logic to JournalAgent

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { JournalAgent } from "@/llm-service/agents";
import { AgentContext } from "@/llm-service/types";

export async function POST(req: NextRequest) {
  try {
    // Setup Supabase client
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
    
    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const { content, mode } = await req.json();

    // Create agent context
    const context: AgentContext = {
      supabase,
      userId: user.id,
    };

    // Run agent
    const agent = new JournalAgent();
    const result = await agent.run(
      {
        userId: user.id,
        content,
        mode,
      },
      context
    );

    // Return result
    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      response: result.aiResponse,
      threadId: result.threadId,
      message: result.message,
      metadata: result.metadata,
    });

  } catch (error) {
    console.error("Journal API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
