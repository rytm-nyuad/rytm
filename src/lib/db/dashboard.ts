import { createBrowserClient } from "@supabase/ssr";
import type { DailyOverall, Meal, WaterLog, DailyCheckIn, StreakData } from "@/types/dashboard";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Check if user has answered daily overall question today
export async function getTodayOverall(userId: string): Promise<DailyOverall | null> {
  const today = new Date().toISOString().split("T")[0];
  
  const { data, error } = await supabase
    .from("daily_overall")
    .select("*")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  if (error) {
    console.error("Error fetching today's overall:", error);
    return null;
  }

  return data;
}

// Submit daily overall score
export async function submitDailyOverall(userId: string, score: number): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  
  console.log("Attempting to insert:", { userId, date: today, score });
  
  const { data, error } = await supabase
    .from("daily_overall")
    .insert({
      user_id: userId,
      date: today,
      overall_score: score,
    })
    .select();

  if (error) {
    console.error("Error submitting daily overall:", error);
    return false;
  }

  console.log("Successfully inserted:", data);
  return true;
}

// Get today's meals count
export async function getTodayMealsCount(userId: string): Promise<number> {
  const today = new Date().toISOString().split("T")[0];
  
  const { data, error } = await supabase
    .from("meal_logs")
    .select("id")
    .eq("user_id", userId)
    .gte("meal_datetime", `${today}T00:00:00`)
    .lt("meal_datetime", `${today}T23:59:59`);

  if (error) {
    console.error("Error fetching meals:", error);
    return 0;
  }

  return data?.length || 0;
}

// Log a meal
export async function logMeal(
  userId: string,
  mealType: string,
  description?: string,
  photoUrl?: string
): Promise<boolean> {
  console.log("logMeal called with:", { userId, mealType, description });
  
  const { data, error } = await supabase
    .from("meal_logs")
    .insert({
      user_id: userId,
      meal_type: mealType,
      description,
      photo_url: photoUrl,
      meal_datetime: new Date().toISOString(),
    })
    .select();

  if (error) {
    console.error("Error logging meal:", error);
    return false;
  }

  console.log("Meal logged successfully:", data);
  return true;
}

// Check if water logged today
export async function hasWaterLoggedToday(userId: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  
  const { data, error } = await supabase
    .from("water_intake_logs")
    .select("id")
    .eq("user_id", userId)
    .gte("intake_datetime", `${today}T00:00:00`)
    .lt("intake_datetime", `${today}T23:59:59`)
    .limit(1);

  if (error) {
    console.error("Error checking water:", error);
    return false;
  }

  return data && data.length > 0;
}

// Log water intake
export async function logWater(
  userId: string,
  amountMl: number,
  source: string
): Promise<boolean> {
  console.log("logWater called with:", { userId, amountMl, source });
  
  const { data, error } = await supabase
    .from("water_intake_logs")
    .insert({
      user_id: userId,
      amount_ml: amountMl,
      source,
      intake_datetime: new Date().toISOString(),
    })
    .select();

  if (error) {
    console.error("Error logging water:", error);
    return false;
  }

  console.log("Water logged successfully:", data);
  return true;
}

// Check if daily check-in completed today
export async function hasCheckInToday(userId: string): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  
  const { data, error } = await supabase
    .from("daily_checkins")
    .select("sleep_quality, energy_score, focus_score, workload_score, coping_capacity_score, stress_score, stress_unexpected_score, social_score, mood_score, mood_stability_score, mood_emotions")
    .eq("user_id", userId)
    .gte("created_at", `${today}T00:00:00`)
    .lt("created_at", `${today}T23:59:59`)
    .limit(1);

  if (error) {
    console.error("Error checking check-in:", error);
    return false;
  }

  if (!data || data.length === 0) {
    return false;
  }

  const checkin = data[0];

  // Check if all required fields are filled
  return !!
    (checkin &&
    checkin.sleep_quality !== null &&
    checkin.energy_score !== null &&
    checkin.focus_score !== null &&
    checkin.workload_score !== null &&
    checkin.coping_capacity_score !== null &&
    checkin.stress_score !== null &&
    checkin.stress_unexpected_score !== null &&
    checkin.social_score !== null &&
    checkin.mood_score !== null &&
    checkin.mood_stability_score !== null &&
    checkin.mood_emotions &&
    checkin.mood_emotions.length > 0);
}

// Submit daily check-in
export async function submitDailyCheckIn(
  userId: string,
  sleepQuality: number,
  energy: number,
  focus: number,
  workload: number,
  copingCapacity: number,
  stress: number,
  stressUnexpected: number,
  social: number,
  mood: number,
  moodStability: number,
  emotions: string[]
): Promise<boolean> {
  const { data, error } = await supabase
    .from("daily_checkins")
    .insert({
      user_id: userId,
      sleep_quality: sleepQuality,
      energy_score: energy,
      focus_score: focus,
      workload_score: workload,
      coping_capacity_score: copingCapacity,
      stress_score: stress,
      stress_unexpected_score: stressUnexpected,
      social_score: social,
      mood_score: mood,
      mood_stability_score: moodStability,
      mood_emotions: emotions,
    })
    .select();

  if (error) {
    console.error("Error submitting check-in:", error);
    return false;
  }

  console.log("Check-in logged successfully:", data);
  return true;
}

// Get current streak (based on: overall + 1 meal + 1 drink + 1 journal chat per day)
export async function getStreakData(userId: string): Promise<number> {
  try {
    // Get user's activity history ordered by date descending
    const { data: overallData } = await supabase
      .from("daily_overall")
      .select("date")
      .eq("user_id", userId)
      .order("date", { ascending: false });

    if (!overallData || overallData.length === 0) return 0;

    let streak = 0;
    const today = new Date().toISOString().split("T")[0];
    let currentDate = new Date(today);

    // Check each day going backwards
    for (let i = 0; i < overallData.length; i++) {
      const checkDate = currentDate.toISOString().split("T")[0];
      
      // Check if this date has all requirements
      const hasOverall = overallData.some((d) => d.date === checkDate);
      
      // Check meals (at least 1)
      const { data: meals } = await supabase
        .from("meal_logs")
        .select("id")
        .eq("user_id", userId)
        .gte("meal_datetime", `${checkDate}T00:00:00`)
        .lt("meal_datetime", `${checkDate}T23:59:59`)
        .limit(1);

      // Check water/drinks (at least 1)
      const { data: water } = await supabase
        .from("water_intake_logs")
        .select("id")
        .eq("user_id", userId)
        .gte("intake_datetime", `${checkDate}T00:00:00`)
        .lt("intake_datetime", `${checkDate}T23:59:59`)
        .limit(1);

      // Check journal (at least 1 message, free or guided)
      const { data: journal } = await supabase
        .from("journal_messages")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", `${checkDate}T00:00:00`)
        .lt("created_at", `${checkDate}T23:59:59`)
        .limit(1);

      // Check daily check-in (10 VAS questions)
      const { data: checkin } = await supabase
        .from("daily_checkins")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", `${checkDate}T00:00:00`)
        .lt("created_at", `${checkDate}T23:59:59`)
        .limit(1);

      if (hasOverall && meals && meals.length > 0 && water && water.length > 0 && journal && journal.length > 0 && checkin && checkin.length > 0) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  } catch (error) {
    console.error("Error calculating streak:", error);
    return 0;
  }
}

// Get last 7 days of activity (for weekly view)
export async function getWeeklyActivity(userId: string): Promise<boolean[]> {
  try {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    // Calculate days since Monday (convert Sunday from 0 to 7 for calculation)
    const daysSinceMonday = currentDay === 0 ? 6 : currentDay - 1;
    
    const weeklyData: boolean[] = [];

    // Get data for the current week (Monday to Sunday)
    for (let i = 0; i < 7; i++) {
      const checkDate = new Date(today);
      // Calculate offset from Monday
      checkDate.setDate(today.getDate() - daysSinceMonday + i);
      const dateStr = checkDate.toISOString().split("T")[0];

      // Check if this date has all requirements
      const { data: overall } = await supabase
        .from("daily_overall")
        .select("id")
        .eq("user_id", userId)
        .eq("date", dateStr)
        .limit(1);

      const { data: meals } = await supabase
        .from("meal_logs")
        .select("id")
        .eq("user_id", userId)
        .gte("meal_datetime", `${dateStr}T00:00:00`)
        .lt("meal_datetime", `${dateStr}T23:59:59`)
        .limit(1);

      const { data: water } = await supabase
        .from("water_intake_logs")
        .select("id")
        .eq("user_id", userId)
        .gte("intake_datetime", `${dateStr}T00:00:00`)
        .lt("intake_datetime", `${dateStr}T23:59:59`)
        .limit(1);

      const { data: journal } = await supabase
        .from("journal_messages")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", `${dateStr}T00:00:00`)
        .lt("created_at", `${dateStr}T23:59:59`)
        .limit(1);

      const { data: checkin } = await supabase
        .from("daily_checkins")
        .select("id")
        .eq("user_id", userId)
        .gte("created_at", `${dateStr}T00:00:00`)
        .lt("created_at", `${dateStr}T23:59:59`)
        .limit(1);

      const isCompleted = 
        overall && overall.length > 0 &&
        meals && meals.length > 0 &&
        water && water.length > 0 &&
        journal && journal.length > 0 &&
        checkin && checkin.length > 0;

      weeklyData.push(isCompleted);
    }

    return weeklyData;
  } catch (error) {
    console.error("Error getting weekly activity:", error);
    return [false, false, false, false, false, false, false];
  }
}
