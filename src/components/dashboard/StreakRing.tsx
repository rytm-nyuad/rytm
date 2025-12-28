"use client";

import { useEffect, useState } from "react";

interface StreakRingProps {
  streak: number;
  tasksCompleted?: number;
  totalTasks?: number;
}

export function StreakRing({ streak, tasksCompleted = 0, totalTasks = 5 }: StreakRingProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Calculate circle properties (smaller size)
  const size = 120;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(streak / 30, 1); // Cap at 30 days for visual purposes
  const offset = circumference - progress * circumference;

  // Mini sparkline data (last 7 days - placeholder)
  const last7Days = [0.8, 1, 0.6, 1, 1, 0.9, 1]; // 1 = complete, 0-0.99 = partial/incomplete

  const tasksRemaining = totalTasks - tasksCompleted;
  const showNudge = tasksRemaining > 0 && tasksRemaining <= 2;

  return (
    <div className="relative flex flex-col items-center justify-center w-full">
      {/* SVG Ring */}
      <svg
        width={size}
        height={size}
        className="transform -rotate-90 mb-2"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#27272a"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle with sweep animation */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#ffffff"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={animated ? offset : circumference}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>

      {/* Center content */}
      <div className="absolute top-0 flex flex-col items-center justify-center" style={{ height: size }}>
        <div className="text-4xl font-bold text-white">{streak}</div>
        <div className="text-xs font-medium text-zinc-500">days</div>
      </div>

      {/* Mini sparkline - last 7 days */}
      <div className="flex items-end gap-1 mb-2">
        {last7Days.map((value, i) => (
          <div
            key={i}
            className="w-1.5 bg-zinc-700 rounded-full transition-all duration-300"
            style={{
              height: `${12 + value * 8}px`,
              opacity: 0.5 + value * 0.5,
            }}
          />
        ))}
      </div>

      {/* Text */}
      <p className="text-xs text-zinc-500">Keep your rhythm alive.</p>

      {/* Contextual nudge */}
      {showNudge && (
        <div className="mt-2 px-2.5 py-1 bg-zinc-800 border border-zinc-700 rounded-full">
          <p className="text-[10px] text-zinc-400">
            {tasksRemaining} away
          </p>
        </div>
      )}
    </div>
  );
}
