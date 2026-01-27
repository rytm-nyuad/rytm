"use client";

interface WeeklyStreakProps {
  weeklyData: boolean[];
  streak: number;
}

export function WeeklyStreak({ weeklyData, streak }: WeeklyStreakProps) {
  // Generate day letters for the last 7 days (6 days ago through today)
  const getDayLetters = () => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const today = new Date();
    const dayLetters: string[] = [];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      dayLetters.push(days[date.getDay()]);
    }
    
    return dayLetters;
  };

  const dayLetters = getDayLetters();
  const todayIndex = 6; // Today is always the last (7th) circle

  return (
    <div className="w-full max-w-sm px-2 mx-auto">
      {/* Weekly Days */}
      <div className="flex justify-between gap-1 sm:gap-2 mb-3 sm:mb-4">
        {dayLetters.map((day, index) => {
          const isCompleted = weeklyData[index];
          const isToday = index === todayIndex;
          return (
            <div key={index} className="flex flex-col items-center gap-0.5 sm:gap-1">
              <div
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-colors relative ${
                  isCompleted
                    ? 'dark:bg-green-600 light:bg-green-500 text-white'
                    : 'dark:bg-zinc-800 light:bg-slate-100 light:border light:border-slate-300 dark:text-zinc-600 light:text-slate-400'
                } ${
                  isToday ? 'ring-2 ring-white dark:ring-white light:ring-cyan-500 ring-offset-2 dark:ring-offset-black light:ring-offset-white' : ''
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
              <span className={`text-[9px] font-medium ${
                isToday 
                  ? 'dark:text-white light:text-cyan-600 font-bold' 
                  : 'dark:text-zinc-600 light:text-slate-500'
              }`}>
                {day}
              </span>
            </div>
          );
        })}
      </div>

      {/* Motivational Text */}
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-xs sm:text-sm font-medium dark:text-zinc-400 light:text-slate-600 text-center">
          One good day builds momentum
        </p>
      </div>
    </div>
  );
}
