"use client";

import { useState } from "react";

interface OverallSliderCardProps {
  onSubmit: (score: number) => Promise<void>;
}

export function OverallSliderCard({ onSubmit }: OverallSliderCardProps) {
  const [score, setScore] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    console.log("OverallSliderCard: Button clicked, score:", score);
    setSubmitting(true);
    try {
      await onSubmit(score);
      console.log("OverallSliderCard: onSubmit completed");
    } catch (error) {
      console.error("OverallSliderCard: Error in onSubmit:", error);
    }
    setSubmitting(false);
  };

  return (
    <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-10">
      {/* Content */}
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">
          How do you feel overall today?
        </h2>
        <p className="text-zinc-400 text-base">
          {/* Physical + mental. First thing in the morning. */}
        </p>
      </div>

      {/* Slider */}
      <div className="mb-10">
        <div className="relative px-4">
          {/* Track */}
          <div className="h-2 bg-zinc-800 rounded-full mb-6 relative">
            <div
              className="h-full bg-white rounded-full transition-all duration-200"
              style={{ width: `${score}%` }}
            />
            {/* Slider Handle (Circle) */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full shadow-lg transition-all duration-200"
              style={{ left: `${score}%`, transform: `translate(-50%, -50%)` }}
            />
          </div>

          {/* Slider Input */}
          <input
            type="range"
            min="0"
            max="100"
            value={score}
            onChange={(e) => setScore(parseInt(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
            disabled={submitting}
            style={{ top: 0, left: 0, right: 0 }}
          />
        </div>

        {/* Labels */}
        <div className="flex justify-between text-xs text-zinc-500 px-4">
          <span>Extremely Poor</span>
          <span>Excellent</span>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full h-12 bg-white text-black font-medium rounded-xl hover:bg-zinc-100 transition-all duration-200 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Unlocking..." : "Unlock Dashboard"}
      </button>

      {/* Info */}
      <p className="text-center text-xs text-zinc-500 mt-4">
        This helps us understand your baseline for the day
      </p>
    </div>
  );
}
