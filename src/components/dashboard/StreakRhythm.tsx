"use client";

import { StreakRing } from "./StreakRing";

interface StreakRhythmProps {
  streak: number;
  tasksCompleted: number;
  totalTasks: number;
}

export function StreakRhythm({
  streak,
  tasksCompleted,
  totalTasks,
}: StreakRhythmProps) {
  const isComplete = tasksCompleted === totalTasks;

  // Number of visible bars (responsive later if needed)
  const bars = Array.from({ length: 16 });

  return (
    <div className="relative flex items-center justify-center w-full py-8">
      {/* ======================================= */}
      {/* SOUND BARS (BACKGROUND LAYER) */}
      {/* ======================================= */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="flex gap-2 overflow-hidden w-full">
          {bars.map((_, i) => {
            // Height pattern (pseudo-sinusoidal)
            const heights = [16, 24, 36, 48, 36, 24];
            const height = heights[i % heights.length];

            return (
              <div
                key={i}
                /* CHANGE: conditional animation + thicker bars */
                className={`
                  w-2 rounded-full opacity-70
                  ${isComplete
                    ? "bg-gradient-to-t from-blue-400 via-green-400 to-yellow-300 animate-streak-bar"
                    : "border border-zinc-600"}
                `}
                /* CHANGE: staggered animation delay */
                style={{
                  height,
                  animationDelay: `${i * 120}ms`,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* ======================================= */}
      {/* STREAK RING (FOREGROUND) */}
      {/* ======================================= */}
      <div className="relative z-10 scale-[1.3] md:scale-[1.5]">
        <StreakRing
          streak={streak}
          tasksCompleted={tasksCompleted}
          totalTasks={totalTasks}
        />
      </div>

      <style jsx>{`
        @keyframes streakPulse {
          0% {
            transform: scaleY(1);
          }
          50% {
            transform: scaleY(1.25);
          }
          100% {
            transform: scaleY(1);
          }
        }

        .animate-streak-bar {
          animation: streakPulse 2.8s ease-in-out infinite;
          transform-origin: bottom;
        }
      `}</style>
    </div>
    
  );
}
