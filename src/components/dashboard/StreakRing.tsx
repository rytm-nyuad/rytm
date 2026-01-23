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
  totalTasks = 5,
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
            className="absolute bottom-0 flex items-end gap-2"
            style={{
              right: `calc(50% + ${ringClearance}px)`,
              width: "40%", // controls how far bars extend outward
              justifyContent: "flex-end",
            }}
          >
            {bars.map((_, i) => {
              const staticHeight =
              base + Math.abs(Math.sin(i * 0.6)) * (maxBarHeight - base);

            const isComplete = tasksCompleted === totalTasks;

            const animatedHeight =
              base +
              Math.abs(Math.sin(t * 0.8 + i * 0.6)) * (maxBarHeight * 0.75);

            const height = isComplete ? animatedHeight : staticHeight;

              return (
                <div
                  key={`left-${i}`}
                  className={`w-4 flex-shrink-0 rounded-full transition-[height] duration-200 ease-out ${
                    tasksCompleted === totalTasks
                      ? "bg-gradient-to-t from-blue-400 via-green-400 to-yellow-300"
                      : "dark:border dark:border-zinc-600 dark:opacity-60 light:border light:border-purple-300 light:opacity-60"
                  }`}
                  style={{ height }}
                />
              );
            })}
          </div>

          {/* RIGHT BARS */}
          <div
            className="absolute bottom-0 flex items-end gap-2"
            style={{
              left: `calc(50% + ${ringClearance}px)`,
              width: "40%", // SAME width = perfect symmetry
              justifyContent: "flex-start",
            }}
          >
            {bars.map((_, i) => {
              const staticHeight =
              base + Math.abs(Math.sin(i * 0.6)) * (maxBarHeight - base);

              const isComplete = tasksCompleted === totalTasks;

              const animatedHeight =
                base +
                Math.abs(Math.sin(t * 0.8 + i * 0.6)) * (maxBarHeight * 0.75);

              const height = isComplete ? animatedHeight : staticHeight;

              return (
                <div
                  key={`right-${i}`}
                  className={`w-4 flex-shrink-0 rounded-full transition-[height] duration-200 ease-out ${
                    tasksCompleted === totalTasks
                      ? "bg-gradient-to-t from-blue-400 via-green-400 to-yellow-300"
                      : "dark:border dark:border-zinc-600 dark:opacity-60 light:border light:border-purple-300 light:opacity-60"
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
        <svg
          width={size}
          height={size}
          className="transform -rotate-90 mb-2"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="dark:stroke-zinc-800 light:stroke-cyan-300"
            strokeWidth={strokeWidth}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            className="dark:stroke-white light:stroke-white transition-all duration-1000 ease-out"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={animated ? offset : circumference}
            strokeLinecap="round"
          />
        </svg>

        <div
          className="absolute top-0 flex flex-col items-center justify-center"
          style={{ height: size, width: size }}
        >
          <div className="text-4xl font-bold text-white">{streak}</div>
          <div className="text-xs font-medium dark:text-zinc-500 light:text-cyan-100">days</div>
        </div>
      </div>

      {/* KEEP */}
      <p className="mt-2 text-xs dark:text-zinc-500 light:text-cyan-100">Keep your rytm alive.</p>

      {/* KEEP */}
      {showNudge && (
        <div className="mt-4 px-2.5 py-1 dark:bg-zinc-800 dark:border-zinc-700 light:bg-cyan-400 light:border-cyan-300 border rounded-full">
          <p className="text-[10px] dark:text-zinc-400 light:text-white">
            {tasksRemaining} away
          </p>
        </div>
      )}
    </div>
  );
}
