// src/lib/db/todos.ts
// Client-side helpers for daily_todos CRUD via Supabase browser client.

import { createClient } from "@/lib/supabase/browser";
import type { DailyTodo } from "@/types/todo";

function supabase() {
  return createClient();
}

/**
 * Fetch all todos for a specific user + date.
 * Returns active (not completed) sorted by created_at ASC,
 * then completed sorted by completed_at DESC.
 */
export async function listTodosByDate(
  userId: string,
  date: string // YYYY-MM-DD
): Promise<{ active: DailyTodo[]; completed: DailyTodo[] }> {
  const { data, error } = await supabase()
    .from("daily_todos")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("listTodosByDate error:", error);
    return { active: [], completed: [] };
  }

  const todos = (data || []) as DailyTodo[];

  const active = todos
    .filter((t) => !t.is_completed)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const completed = todos
    .filter((t) => t.is_completed)
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at).getTime() : new Date(a.created_at).getTime();
      const bTime = b.completed_at ? new Date(b.completed_at).getTime() : new Date(b.created_at).getTime();
      return bTime - aTime; // DESC
    });

  return { active, completed };
}

/**
 * Add a new todo for a given date.
 */
export async function addTodo(
  userId: string,
  date: string,
  text: string
): Promise<DailyTodo | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase()
    .from("daily_todos")
    .insert({
      user_id: userId,
      date,
      text: trimmed,
    })
    .select("*")
    .single();

  if (error) {
    console.error("addTodo error:", error);
    return null;
  }

  return data as DailyTodo;
}

/**
 * Toggle completion status of a todo.
 */
export async function toggleTodo(
  todoId: string,
  isCompleted: boolean
): Promise<boolean> {
  const { error } = await supabase()
    .from("daily_todos")
    .update({
      is_completed: isCompleted,
      completed_at: isCompleted ? new Date().toISOString() : null,
    })
    .eq("id", todoId);

  if (error) {
    console.error("toggleTodo error:", error);
    return false;
  }

  return true;
}

/**
 * Delete a todo by id.
 */
export async function deleteTodo(todoId: string): Promise<boolean> {
  const { error } = await supabase()
    .from("daily_todos")
    .delete()
    .eq("id", todoId);

  if (error) {
    console.error("deleteTodo error:", error);
    return false;
  }

  return true;
}
