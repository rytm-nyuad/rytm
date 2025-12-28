"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface TaskStatus {
  overallQuestion: boolean;
  mealLogged: boolean;
  waterLogged: boolean;
  checkInCompleted: boolean;
  journalCompleted: boolean;
}

interface NudgeToastProps {
  tasks: TaskStatus;
  onAction: (action: 'meal' | 'water' | 'checkin' | 'journal') => void;
}

export function NudgeToast({ tasks, onAction }: NudgeToastProps) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Determine first pending task
  const getFirstPendingTask = () => {
    if (!tasks.mealLogged) return { label: 'Log meal now', action: 'meal' as const };
    if (!tasks.waterLogged) return { label: 'Log water now', action: 'water' as const };
    if (!tasks.checkInCompleted) return { label: 'Daily check-in now', action: 'checkin' as const };
    if (!tasks.journalCompleted) return { label: 'Journal now', action: 'journal' as const };
    return null;
  };

  const pendingTask = getFirstPendingTask();
  const completedCount = Object.values(tasks).filter(Boolean).length;
  const totalTasks = Object.keys(tasks).length;

  useEffect(() => {
    // Only show if tasks are incomplete and hasn't been dismissed
    if (pendingTask && !dismissed) {
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, [pendingTask, dismissed]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => setDismissed(true), 300);
  };

  const handleAction = () => {
    if (pendingTask) {
      onAction(pendingTask.action);
      handleDismiss();
    }
  };

  if (!visible || dismissed || !pendingTask) return null;

  const remaining = totalTasks - completedCount;
  const message =
    remaining === 1
      ? "One check-in and your streak survives."
      : `${remaining} tasks left to keep your streak alive.`;

  return (
    <div className="fixed top-20 right-6 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 pr-12 max-w-sm relative">
        <p className="text-sm text-zinc-300 mb-3">{message}</p>
        <button
          onClick={handleAction}
          className="px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors text-sm font-medium"
        >
          {pendingTask.label}
        </button>
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
