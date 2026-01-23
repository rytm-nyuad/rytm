"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

interface MorningGateProps {
  onSubmit: (score: number) => Promise<void>;
}

export function MorningGate({ onSubmit }: MorningGateProps) {
  const [score, setScore] = useState(50);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit(Math.round(score));
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-8">
        {/* Content */}
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-white mb-3">Good Morning</h2>
          <p className="text-zinc-400 text-lg">
            Before we start, how do you feel overall today?
          </p>
        </div>

        {/* Slider */}
        <div className="mb-8">
          <div className="relative px-4">
            {/* Track */}
            <div className="h-2 bg-zinc-800 rounded-full mb-4 relative">
              <div
                className="h-full bg-white rounded-full"
                style={{ width: `${score}%` }}
              />
              {/* Slider Handle (Circle) */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full border-2 border-white shadow-lg"
                style={{ left: `${score}%`, transform: `translate(-50%, -50%)` }}
              />
            </div>

            {/* Slider Input */}
            <input
              type="range"
              min="0"
              max="100"
              step="any"
              value={score}
              onChange={(e) => setScore(parseFloat(e.target.value))}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              disabled={submitting}
              style={{ top: 0, left: 0, right: 0 }}
            />
          </div>

          {/* Labels */}
          <div className="flex justify-between text-xs text-zinc-500 mb-6 px-4">
            <span>Extremely Poor</span>
            <span>Excellent</span>
          </div>
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full h-12 text-lg"
        >
          {submitting ? "Submitting..." : "Continue to Dashboard"}
        </Button>

        {/* Info */}
        <p className="text-center text-xs text-zinc-600 mt-4">
          This helps us understand your baseline for the day
        </p>
      </div>
    </div>
  );
}
