"use client";

interface ProgressListProps {
  progress: {
    overallQuestion: boolean;
    mealLogged: boolean;
    waterLogged: boolean;
    checkInCompleted: boolean;
    journalCompleted: boolean;
  };
  onAction?: (action: 'meal' | 'water' | 'checkin' | 'journal') => void;
}

export function ProgressList({ progress, onAction }: ProgressListProps) {
  const tasks = [
    { label: "Overall mood", completed: progress.overallQuestion, action: null },
    { label: "Log a meal", completed: progress.mealLogged, action: 'meal' as const },
    { label: "Log water", completed: progress.waterLogged, action: 'water' as const },
    { label: "Daily check-in", completed: progress.checkInCompleted, action: 'checkin' as const },
    { label: "Journal entry", completed: progress.journalCompleted, action: 'journal' as const },
  ];

  const completedCount = tasks.filter((t) => t.completed).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-white">Today</h3>
        <span className="text-xs font-medium text-zinc-400">
          {completedCount}/5 complete
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
                  task.completed ? "bg-white" : "bg-zinc-700"
                }`}
              />
              <span
                className={`text-xs ${
                  task.completed
                    ? "text-white font-medium"
                    : "text-zinc-500"
                }`}
              >
                {task.label}
              </span>
            </div>

            {/* Status pill / CTA button */}
            {task.action === 'meal' && onAction ? (
              <div className="flex gap-1.5">
                {task.completed && (
                  <div className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white text-black">
                    DONE
                  </div>
                )}
                <button
                  onClick={() => onAction(task.action!)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  + MEAL
                </button>
              </div>
            ) : task.completed ? (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white text-black">
                DONE
              </div>
            ) : task.action && onAction ? (
              <button
                onClick={() => onAction(task.action!)}
                className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-600 text-white hover:bg-purple-700 transition-colors cursor-pointer"
              >
                LOG NOW
              </button>
            ) : (
              <div className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-500">
                PENDING
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
