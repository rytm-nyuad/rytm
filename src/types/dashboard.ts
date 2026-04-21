export interface DailyOverall {
  uid: string;
  date: string;
  overall_score: number;
  created_at: string;
}

export interface Meal {
  id: string;
  user_id: string;
  meal_category: "Breakfast" | "Lunch" | "Dinner" | "Snack" | "Drink";
  description?: string;
  image_url?: string;
  logged_at: string;
}

export interface WaterLog {
  id: string;
  user_id: string;
  water_ml?: number;
  coffee_cups?: number;
  tea_cups?: number;
  soda_ml?: number;
  energy_drink_ml?: number;
  logged_at: string;
}

export interface DailyCheckIn {
  id: string;
  user_id: string;
  date: string;
  mood: number;
  stress: number;
  energy: number;
  focus: number;
  workload: number;
  sleep_restfulness: number;
  social_connectedness: number;
  emotions: string[];
  created_at: string;
}

export interface StreakData {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_activity_date: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface TodayProgress {
  overallQuestion: boolean;
  mealLogged: boolean;
  checkInCompleted: boolean;
  journalCompleted: boolean;
}

/**
 * Shape of a meal_logs row returned from Supabase.
 * Used to display the "Logged today" summary on the checklist screen.
 */
export interface MealLogEntry {
  id: string;
  user_id: string;
  meal_type: string;           // e.g. 'breakfast', 'lunch', 'dinner', 'snack', 'drink'
  description: string | null;
  photo_url: string | null;
  meal_local_date: string;     // YYYY-MM-DD local day selected in UI
  meal_datetime: string | null; // ISO timestamptz when exact time is known
}
