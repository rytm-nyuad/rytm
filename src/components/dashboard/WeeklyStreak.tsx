"use client";

interface WeeklyStreakProps {
  weeklyData: boolean[];
  streak: number;
}

export function WeeklyStreak({ weeklyData, streak }: WeeklyStreakProps) {
  return (
    <div className="w-full max-w-[300px] px-2 mx-auto">
      {/* Weekly Days */}
      <div className="flex justify-between gap-2 mb-4">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => {
          const isCompleted = weeklyData[index];
          return (
            <div key={index} className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  isCompleted
                    ? 'dark:bg-green-600 light:bg-green-500 text-white'
                    : 'dark:bg-zinc-800 light:bg-cyan-400/30 dark:text-zinc-600 light:text-cyan-300'
                }`}
              >
                {isCompleted && (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <span className="text-[9px] font-medium dark:text-zinc-600 light:text-cyan-200">
                {day}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current Streak */}
      <div className="flex items-center justify-center gap-2 dark:text-zinc-400 light:text-white">
        <span className="text-base">⚡</span>
        <span className="text-xs font-medium">Current Streak</span>
        <span className="text-xs font-bold">{streak} days</span>
      </div>
    </div>
  );
}
