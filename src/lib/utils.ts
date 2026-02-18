import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format meal type value to human-readable label
 * @param mealType - The meal_type value from the database
 * @returns Human-readable label for display
 */
export function formatMealTypeLabel(mealType: string): string {
  const mealTypeLabels: Record<string, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
    drink: "Drink",
    other: "Other",
    ramadan_iftar: "Ramadan: Iftar",
    ramadan_suhoor: "Ramadan: Suhoor",
  };
  
  return mealTypeLabels[mealType] || mealType.charAt(0).toUpperCase() + mealType.slice(1);
}
