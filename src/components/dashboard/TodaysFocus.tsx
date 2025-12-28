"use client";

import { useEffect, useState } from "react";

const focusTips = [
  "Small actions compound into lasting change",
  "Consistency beats intensity",
  "Every day is a fresh start",
  "Progress, not perfection",
  "Your rhythm, your rules",
  "Show up for yourself today",
  "Trust the process, respect the journey",
  "One percent better every day",
  "Build the life you want, one choice at a time",
  "Your future self will thank you",
];

export function TodaysFocus() {
  const [tip, setTip] = useState("");

  useEffect(() => {
    // Rotate tip based on day of year to keep it consistent per day
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    setTip(focusTips[dayOfYear % focusTips.length]);
  }, []);

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full">
      <span className="text-xs text-zinc-500 font-medium">Today's focus:</span>
      <span className="text-xs text-zinc-400">{tip}</span>
    </div>
  );
}
