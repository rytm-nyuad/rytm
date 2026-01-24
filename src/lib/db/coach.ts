import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface CoachConversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// Get all conversations for a user
export async function getCoachConversations(userId: string): Promise<CoachConversation[]> {
  const { data, error } = await supabase
    .from("coach_threads")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error fetching coach conversations:", error);
    return [];
  }

  return data || [];
}

// Create a new conversation
export async function createCoachConversation(userId: string, title?: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("coach_threads")
    .insert({
      user_id: userId,
      title: title || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creating coach conversation:", error);
    return null;
  }

  return data.id;
}

// Get messages for a conversation
export async function getCoachMessages(conversationId: string): Promise<CoachMessage[]> {
  const { data, error } = await supabase
    .from("coach_messages")
    .select("*")
    .eq("thread_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching coach messages:", error);
    return [];
  }

  return data || [];
}

// Add a message to a conversation
export async function addCoachMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  userId: string
): Promise<boolean> {
  const { error } = await supabase
    .from("coach_messages")
    .insert({
      thread_id: conversationId,
      user_id: userId,
      role,
      content,
    });

  if (error) {
    console.error("Error adding coach message:", error);
    return false;
  }

  // Update conversation's updated_at timestamp
  await supabase
    .from("coach_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return true;
}

// Delete a conversation
export async function deleteCoachConversation(conversationId: string): Promise<boolean> {
  const { error } = await supabase
    .from("coach_threads")
    .delete()
    .eq("id", conversationId);

  if (error) {
    console.error("Error deleting coach conversation:", error);
    return false;
  }

  return true;
}

// Update conversation title
export async function updateCoachConversationTitle(
  conversationId: string,
  title: string
): Promise<boolean> {
  const { error } = await supabase
    .from("coach_threads")
    .update({ title })
    .eq("id", conversationId);

  if (error) {
    console.error("Error updating conversation title:", error);
    return false;
  }

  return true;
}
