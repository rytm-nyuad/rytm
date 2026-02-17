// src/types/todo.ts

export interface DailyTodo {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  text: string;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
