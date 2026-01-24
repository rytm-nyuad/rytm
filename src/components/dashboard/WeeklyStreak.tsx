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
                    : 'dark:bg-zinc-800 light:bg-white light:border light:border-gray-200 dark:text-zinc-600 light:text-gray-400'
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
              <span className="text-[9px] font-medium dark:text-zinc-600 light:text-slate-500">
                {day}
              </span>
            </div>
          );
        })}
      </div>

      {/* Motivational Text */}
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-xs font-medium dark:text-zinc-400 light:text-slate-700">
          One good day builds momentum
        </p>
      </div>
    </div>
  );
}
