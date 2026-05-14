"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatLocalDate, formatLocalDisplayDate, isSameLocalDay, normalizeToNoon } from "@/lib/time";
import { formatMealTypeLabel } from "@/lib/utils";
import type { MealLogEntry } from "@/types/dashboard";

interface ProgressListProps {
  canonicalTimeZone: string;
  progress: {
    overallQuestion: boolean;
    mealLogged: boolean;
    checkInCompleted: boolean;
    journalCompleted: boolean;
  };
  currentDate: Date;
  onDateChange: (date: Date) => void;
  onAction?: (action: 'overall' | 'meal' | 'checkin' | 'journal') => void;
  /** Meals logged for the selected date, shown below divider */
  loggedMeals?: MealLogEntry[];
}

/**
 * Format a timestamptz into a local time string like "7:30 AM".
 */
function formatMealTime(datetime: string | null, tz: string): string {
  try {
    if (!datetime) return "Time not set";
    const d = new Date(datetime);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

export function ProgressList({
  canonicalTimeZone,
  progress,
  currentDate,
  onDateChange,
  onAction,
  loggedMeals = [],
}: ProgressListProps) {
  const [mealIndex, setMealIndex] = useState(0);

  // Reset meal pager when date changes
  useEffect(() => { setMealIndex(0); }, [currentDate]);

  // Ensure mealIndex stays in bounds
  const safeMealIndex = loggedMeals.length > 0 ? Math.min(mealIndex, loggedMeals.length - 1) : 0;

  const handlePreviousDay = () => {
    const newDate = normalizeToNoon(currentDate);
    newDate.setDate(newDate.getDate() - 1);
    onDateChange(newDate);
  };

  const handleNextDay = () => {
    const newDate = normalizeToNoon(currentDate);
    newDate.setDate(newDate.getDate() + 1);

    const newLocal = formatLocalDate(newDate, canonicalTimeZone);
    const todayLocal = formatLocalDate(new Date(), canonicalTimeZone);

    if (newLocal <= todayLocal) onDateChange(newDate);
  };

  const isToday = () => isSameLocalDay(currentDate, new Date(), canonicalTimeZone);

  // CHANGE: 4 checklist items (water/nutrition removed)
  const tasks = [
    { label: "Overall mood", completed: progress.overallQuestion, action: 'overall' as const },
    { label: "Log a meal", completed: progress.mealLogged, action: 'meal' as const },
    { label: "Daily check-in", completed: progress.checkInCompleted, action: 'checkin' as const },
    { label: "Journal entry", completed: progress.journalCompleted, action: 'journal' as const },
  ];

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <div className="flex flex-col">
      {/* Header with Date Navigation */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handlePreviousDay}
            className="p-1 rounded-lg dark:text-zinc-400 light:text-slate-600 dark:hover:bg-zinc-800 light:hover:bg-gray-200 transition"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <h3 className="text-base font-semibold dark:text-white light:text-slate-900 min-w-[100px] text-center">
            {formatLocalDisplayDate(currentDate, canonicalTimeZone)}
          </h3>
          <button
            onClick={handleNextDay}
            disabled={isToday()}
            className="p-1 rounded-lg dark:text-zinc-400 light:text-slate-600 dark:hover:bg-zinc-800 light:hover:bg-gray-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <span className="text-xs font-medium dark:text-zinc-400 light:text-slate-600">
          {completedCount}/4 complete
        </span>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map((task, index) => (
          <div
            key={index}
            className="flex items-center justify-between py-1"
          >
            <div className="flex items-center gap-2.5">
              {/* Status dot */}
              <div
                className={`w-1.5 h-1.5 rounded-full ${
                  task.completed ? "dark:bg-white light:bg-blue-600" : "dark:bg-zinc-700 light:bg-gray-300"
                }`}
              />
              <span
                className={`text-xs ${
                  task.completed
                    ? "dark:text-white light:text-slate-900 font-medium"
                    : "dark:text-zinc-500 light:text-slate-600"
                }`}
              >
                {task.label}
              </span>
            </div>

            {/* Status pill / CTA button */}
            {task.action === 'meal' && onAction ? (
              <div className="flex gap-1.5">
                {task.completed && (
                  <div className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-white light:bg-green-50 dark:text-black light:text-green-700 border light:border-green-200">
                    DONE
                  </div>
                )}
                <button
                  onClick={() => onAction(task.action!)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-purple-600 light:bg-purple-600 dark:text-white light:text-white dark:hover:bg-purple-700 light:hover:bg-purple-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  + MEAL
                </button>
              </div>
            ) : task.action === 'journal' && onAction ? (
              <div className="flex gap-1.5">
                {task.completed && (
                  <div className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-white light:bg-green-50 dark:text-black light:text-green-700 border light:border-green-200">
                    DONE
                  </div>
                )}
                <button
                  onClick={() => onAction(task.action!)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-purple-600 light:bg-purple-600 dark:text-white light:text-white dark:hover:bg-purple-700 light:hover:bg-purple-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  + JOURNAL
                </button>
              </div>
            ) : task.completed ? (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-white light:bg-green-50 dark:text-black light:text-green-700 border light:border-green-200">
                DONE
              </div>
            ) : task.action && onAction ? (
              <button
                onClick={() => onAction(task.action!)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-purple-600 light:bg-blue-600 dark:text-white light:text-white dark:hover:bg-purple-700 light:hover:bg-blue-700 transition-colors cursor-pointer"
              >
                LOG NOW
              </button>
            ) : (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-medium dark:bg-zinc-800 dark:text-zinc-500 light:bg-gray-100 light:text-slate-600 border light:border-gray-200">
                PENDING
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ──────────── Divider ──────────── */}
      <div className="my-4 border-t dark:border-zinc-800 light:border-gray-200" />

      {/* ──────────── Logged Meals Pager ──────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold dark:text-zinc-400 light:text-slate-500 uppercase tracking-wider">
            Logged Meals
          </h4>
          {loggedMeals.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMealIndex((prev) => (prev - 1 + loggedMeals.length) % loggedMeals.length)}
                disabled={loggedMeals.length <= 1}
                className="p-0.5 rounded dark:text-zinc-400 light:text-slate-500 dark:hover:bg-zinc-800 light:hover:bg-gray-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous meal"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] dark:text-zinc-500 light:text-slate-500 font-medium min-w-[24px] text-center">
                {safeMealIndex + 1}/{loggedMeals.length}
              </span>
              <button
                onClick={() => setMealIndex((prev) => (prev + 1) % loggedMeals.length)}
                disabled={loggedMeals.length <= 1}
                className="p-0.5 rounded dark:text-zinc-400 light:text-slate-500 dark:hover:bg-zinc-800 light:hover:bg-gray-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next meal"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {loggedMeals.length === 0 ? (
          <p className="text-xs dark:text-zinc-600 light:text-slate-400 italic">
            No meals logged for this day yet.
          </p>
        ) : (
          (() => {
            const meal = loggedMeals[safeMealIndex];
            return (
              <div className="flex items-start justify-between gap-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium dark:text-white light:text-slate-900">
                      {formatMealTypeLabel(meal.meal_type)}
                    </span>
                    <span className="text-[10px] dark:text-zinc-500 light:text-slate-400">
                      {formatMealTime(meal.meal_datetime, canonicalTimeZone)}
                    </span>
                  </div>
                  {meal.description ? (
                    <p className="text-[11px] dark:text-zinc-500 light:text-slate-500 line-clamp-2 mt-0.5 leading-tight max-w-[220px]">
                      {meal.description}
                    </p>
                  ) : (
                    <p className="text-[11px] dark:text-zinc-700 light:text-slate-400 italic mt-0.5">
                      No description
                    </p>
                  )}
                </div>
                {meal.photo_url && (
                  <span className="text-[10px] dark:text-zinc-500 light:text-slate-400 whitespace-nowrap flex-shrink-0">
                    📷 Image uploaded
                  </span>
                )}
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
