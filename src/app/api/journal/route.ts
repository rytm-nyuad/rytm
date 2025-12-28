// API Route for Journal (Guided Mode with LLM)
// POST /api/journal - Send message and get AI response

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getJournalLLM, JOURNAL_SYSTEM_PROMPT } from "@/lib/llms/config";
import { saveJournalMessage, getOrCreateThread, loadThreadMessages } from "@/lib/db/journal";
import { HumanMessage, AIMessage, SystemMessage } from "@langchain/core/messages";

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
    
    // Get authenticated user (secure method)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = user.id;
    const { content, mode } = await req.json();

    // Validate input
    if (!content || !mode) {
      return NextResponse.json(
        { error: "Missing content or mode" },
        { status: 400 }
      );
    }

    // FREE MODE: Just save message, no AI response
    if (mode === "free") {
      const savedMessage = await saveJournalMessage(supabase, userId, content, "free", "user", null);
      
      if (!savedMessage) {
        return NextResponse.json(
          { error: "Failed to save message" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: savedMessage,
      });
    }

    // GUIDED MODE: Get/create thread and run AI agent
    const threadId = await getOrCreateThread(supabase, userId);
    
    if (!threadId) {
      return NextResponse.json(
        { error: "Failed to create thread" },
        { status: 500 }
      );
    }

    // Save user message
    await saveJournalMessage(supabase, userId, content, "guided", "user", threadId);

    // Load conversation history (last 3 message pairs = 6 messages)
    const allHistory = await loadThreadMessages(supabase, threadId);
    const history = allHistory.slice(-6); // Only last 6 messages
    
    // Convert to LangChain message format
    const messages = [
      new SystemMessage(JOURNAL_SYSTEM_PROMPT),
      ...history.map((msg) =>
        msg.role === "user"
          ? new HumanMessage(msg.content)
          : new AIMessage(msg.content)
      ),
    ];

    // Get LLM response
    const llm = getJournalLLM();
    const response = await llm.invoke(messages);

    // Save AI response
    const aiMessage = await saveJournalMessage(
      supabase,
      userId,
      response.content.toString(),
      "guided",
      "assistant",
      threadId
    );

    return NextResponse.json({
      success: true,
      response: response.content.toString(),
      threadId,
      message: aiMessage,
    });

  } catch (error) {
    console.error("Journal API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
