import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getJournalLLM } from "@/llm-service/config/llm";

export const dynamic = "force-dynamic";

interface ParsedMeal {
  mealType: string;
  description: string;
  mealTime: string;
}

const SYSTEM_PROMPT = `You are a meal parser. The user will describe one or more meals they ate today in natural language. Extract each meal into structured data.

Return a JSON array of meals. Each meal object has:
- "mealType": one of "breakfast", "lunch", "dinner", "snack", "drink", "ramadan_iftar", "ramadan_suhoor". Infer from context (e.g. morning = breakfast, coffee = drink).
- "description": a clean, concise description of what was consumed. Include all items mentioned for that meal.
- "mealTime": in "HH:MM" 24-hour format if the user mentioned a time, otherwise "".

Rules:
- If the user describes multiple distinct meals, return multiple objects.
- If a meal includes both food and a drink, split the drink into its own entry with mealType "drink".
- Keep descriptions natural but clean (capitalize first letter, no trailing periods).
- If unsure about meal type, default to "snack".
- Return ONLY the JSON array, no markdown fences, no explanation.

Examples:
Input: "I had eggs and toast for breakfast around 8am, then a chicken wrap for lunch at 1pm"
Output: [{"mealType":"breakfast","description":"Eggs and toast","mealTime":"08:00"},{"mealType":"lunch","description":"Chicken wrap","mealTime":"13:00"}]

Input: "coffee this morning and a shawarma with fries for dinner"
Output: [{"mealType":"drink","description":"Coffee","mealTime":""},{"mealType":"dinner","description":"Shawarma with fries","mealTime":""}]`;

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

    const { transcript } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return NextResponse.json(
        { error: "Missing transcript" },
        { status: 400 }
      );
    }

    const llm = getJournalLLM();

    const response = await llm.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(transcript),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Parse the JSON response
    const cleaned = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const meals: ParsedMeal[] = JSON.parse(cleaned);

    if (!Array.isArray(meals)) {
      return NextResponse.json(
        { error: "Invalid response from AI" },
        { status: 500 }
      );
    }

    return NextResponse.json({ meals });
  } catch (err) {
    console.error("Parse voice meal error:", err);
    return NextResponse.json(
      { error: "Failed to parse meal description" },
      { status: 500 }
    );
  }
}
