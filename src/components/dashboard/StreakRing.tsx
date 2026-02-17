"use client";

import { useEffect, useState } from "react";

interface StreakRingProps {
  streak: number;
  tasksCompleted?: number;
  totalTasks?: number;
}

export function StreakRing({
  streak,
  tasksCompleted = 0,
  totalTasks = 4,
}: StreakRingProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // ADD: animation clock
  const [t, setT] = useState(0);

  useEffect(() => {
    let raf: number;
    const tick = () => {
      setT((prev) => prev + 0.02); // speed control
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* =========================
     KEEP: Ring geometry
  ========================== */
  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  /* CHANGE: progress based on TASK completion */
  const progress = Math.min(tasksCompleted / totalTasks, 1);
  const offset = circumference - progress * circumference;

  /* KEEP: nudge logic */
  const tasksRemaining = totalTasks - tasksCompleted;
  const showNudge = tasksRemaining > 0 && tasksRemaining <= 2;

  /* =========================
     CHANGE: Sound bar layout
  ========================== */
  const barCountPerSide = 7;
  const maxBarHeight = size; // equal to ring diameter
  const ringClearance = size / 2 + 24; // CHANGE: ensures no overlap

  const bars = Array.from({ length: barCountPerSide });

  const base = 16;
  
  return (
    <div className="relative flex flex-col items-center justify-center w-full py-12">
      {/* SOUND BARS — ring-anchored symmetry */}
        <div className="absolute inset-0 pointer-events-none -translate-y-20">
          {/* LEFT BARS */}
          <div
            className="absolute bottom-0 flex items-end gap-1 sm:gap-2"
            style={{
              right: `calc(50% + ${ringClearance}px)`,
              width: "40%", // controls how far bars extend outward
              justifyContent: "flex-end",
            }}
          >
            {bars.map((_, i) => {
              const staticHeight =
              base + Math.abs(Math.sin(i * 0.6)) * (maxBarHeight - base);

            const isComplete = tasksCompleted === totalTasks && totalTasks > 0;

            const animatedHeight =
              base +
              Math.abs(Math.sin(t * 0.8 + i * 0.6)) * (maxBarHeight * 0.75);

            const height = isComplete ? animatedHeight : staticHeight;

              return (
                <div
                  key={`left-${i}`}
                  className={`w-3 sm:w-4 flex-shrink-0 rounded-full transition-[height] duration-200 ease-out ${
                    isComplete
                      ? "bg-gradient-to-t from-blue-400 via-green-400 to-yellow-300"
                      : "dark:border dark:border-zinc-600 dark:opacity-60 light:bg-slate-200 light:border light:border-slate-300"
                  }`}
                  style={{ height }}
                />
              );
            })}
          </div>

          {/* RIGHT BARS */}
          <div
            className="absolute bottom-0 flex items-end gap-1 sm:gap-2"
            style={{
              left: `calc(50% + ${ringClearance}px)`,
              width: "40%", // SAME width = perfect symmetry
              justifyContent: "flex-start",
            }}
          >
            {bars.map((_, i) => {
              const staticHeight =
              base + Math.abs(Math.sin(i * 0.6)) * (maxBarHeight - base);

              const isComplete = tasksCompleted === totalTasks && totalTasks > 0;

              const animatedHeight =
                base +
                Math.abs(Math.sin(t * 0.8 + i * 0.6)) * (maxBarHeight * 0.75);

              const height = isComplete ? animatedHeight : staticHeight;

              return (
                <div
                  key={`right-${i}`}
                  className={`w-3 sm:w-4 flex-shrink-0 rounded-full transition-[height] duration-200 ease-out ${
                    isComplete
                      ? "bg-gradient-to-t from-blue-400 via-green-400 to-yellow-300"
                      : "dark:border dark:border-zinc-600 dark:opacity-60 light:bg-slate-200 light:border light:border-slate-300"
                  }`}
                  style={{ height }}
                />
              );
            })}
          </div>
        </div>
      

      {/* =========================
         KEEP: STREAK RING
      ========================== */}
      <div className="relative z-10">
        {/* Add gradient glow for light mode hero element */}
        <div className="absolute inset-0 light:bg-gradient-to-br light:from-blue-500/10 light:via-purple-500/10 light:to-blue-500/10 light:blur-3xl light:rounded-full" />
        
        <svg
          width={size}
          height={size}
          className="transform -rotate-90 mb-2 relative z-10"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="dark:stroke-zinc-800 light:stroke-slate-200"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="transition-all duration-1000 ease-out"
            stroke="url(#streakGradient)"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={animated ? offset : circumference}
            strokeLinecap="round"
          />
          {/* Define gradient for streak progress */}
          <defs>
            <linearGradient id="streakGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" className="dark:[stop-color:white] light:[stop-color:#3b82f6]" />
              <stop offset="50%" className="dark:[stop-color:white] light:[stop-color:#8b5cf6]" />
              <stop offset="100%" className="dark:[stop-color:white] light:[stop-color:#3b82f6]" />
            </linearGradient>
          </defs>
        </svg>

        <div
          className="absolute top-0 flex flex-col items-center justify-center z-20"
          style={{ height: size, width: size }}
        >
          <div className="text-4xl font-bold dark:text-white light:text-cyan-700">{streak}</div>
          <div className="text-xs font-medium dark:text-zinc-500 light:text-slate-500">days</div>
        </div>
      </div>

      {/* KEEP */}
      <p className="mt-2 text-xs dark:text-zinc-500 light:text-slate-500">Keep your rytm alive.</p>
    </div>
  );
}
