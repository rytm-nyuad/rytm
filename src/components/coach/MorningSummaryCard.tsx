"use client";

import { CoachAction, DailyPlan } from "@/lib/coach/types";
import { Zap, Droplets, Moon, Brain, Activity, Target, Flame, Clock, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const DOMAIN_ICONS: Record<string, any> = {
  sleep: Moon,
  recovery: Zap,
  hydration: Droplets,
  nutrition: Flame,
  stress: Brain,
  focus: Brain,
  training: Activity,
  stability: Target,
  productivity: Target,
};

const DOMAIN_COLORS: Record<string, string> = {
  sleep: "text-indigo-400 bg-indigo-400/10",
  recovery: "text-purple-400 bg-purple-400/10",
  hydration: "text-blue-400 bg-blue-400/10",
  nutrition: "text-orange-400 bg-orange-400/10",
  stress: "text-rose-400 bg-rose-400/10",
  focus: "text-violet-400 bg-violet-400/10",
  training: "text-green-400 bg-green-400/10",
  stability: "text-cyan-400 bg-cyan-400/10",
  productivity: "text-yellow-400 bg-yellow-400/10",
};

const EFFORT_COLORS: Record<string, string> = {
  low: "text-emerald-400 bg-emerald-400/10",
  medium: "text-amber-400 bg-amber-400/10",
  high: "text-rose-400 bg-rose-400/10",
};

interface MorningSummaryCardProps {
  plan: DailyPlan;
  energyMode?: string;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
}

function formatGeneratedAt(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function MorningSummaryCard({
  plan,
  energyMode,
  onRegenerate,
  isRegenerating = false,
}: MorningSummaryCardProps) {
  const generatedAt = formatGeneratedAt(plan.updated_at);

  return (
    <div className="space-y-6">
      {/* Morning Message */}
      <div className="relative overflow-hidden rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-6">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500" />
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold dark:text-zinc-500 text-zinc-400 uppercase tracking-widest">
                  Morning Brief — {plan.for_date}
                </p>
                {generatedAt && (
                  <p className="mt-1 text-xs dark:text-zinc-500 text-zinc-500">
                    Generated at {generatedAt}
                  </p>
                )}
              </div>
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  disabled={isRegenerating}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
                  Regenerate
                </button>
              )}
            </div>
            <div className="dark:text-zinc-100 text-zinc-800 text-sm leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold dark:text-white text-zinc-900">{children}</strong>,
                  em: ({ children }) => <em className="dark:text-zinc-400 text-zinc-500 italic">{children}</em>,
                  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-3 space-y-1.5">{children}</ol>,
                  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-3 space-y-1.5">{children}</ul>,
                  li: ({ children }) => <li className="pl-0.5">{children}</li>,
                  h1: ({ children }) => <p className="font-semibold dark:text-white text-zinc-900 mb-2">{children}</p>,
                  h2: ({ children }) => <p className="font-semibold dark:text-white text-zinc-900 mb-2">{children}</p>,
                  h3: ({ children }) => <p className="font-semibold dark:text-white text-zinc-900 mb-2">{children}</p>,
                }}
              >
                {plan.morning_message}
              </ReactMarkdown>
            </div>
            {energyMode && (
              <span className="inline-flex items-center gap-1.5 mt-3 px-2.5 py-1 rounded-full text-xs font-medium dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-300 text-zinc-600">
                <Zap className="w-3 h-3" />
                {energyMode.charAt(0).toUpperCase() + energyMode.slice(1)} Energy Day
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {plan.actions.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold dark:text-zinc-500 text-zinc-400 uppercase tracking-widest px-1">
            Today&apos;s Actions
          </p>
          {plan.actions.map((action, index) => (
            <ActionCard key={action.action_id} action={action} index={index} />
          ))}
        </div>
      )}

      {/* Static disclaimer */}
      <p className="text-xs dark:text-zinc-600 text-zinc-400 px-1">
        These suggestions are for general wellness support and are not medical advice.
      </p>
    </div>
  );
}

function ActionCard({ action, index }: { action: CoachAction; index: number }) {
  const Icon = DOMAIN_ICONS[action.domain] || Target;
  const domainColor = DOMAIN_COLORS[action.domain] || "text-zinc-400 bg-zinc-400/10";
  const effortColor = EFFORT_COLORS[action.effort_level] || EFFORT_COLORS.medium;

  return (
    <div className="flex gap-4 rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-4 hover:dark:border-zinc-700 hover:border-zinc-300 transition-colors">
      <div className="flex-shrink-0 flex flex-col items-center gap-2">
        <span className="w-7 h-7 rounded-full dark:bg-zinc-800 bg-zinc-100 flex items-center justify-center text-xs font-bold dark:text-zinc-400 text-zinc-500">
          {index + 1}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold dark:text-white text-zinc-900 leading-tight">
            {action.title}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${domainColor}`}>
              <Icon className="w-3 h-3" />
              {action.domain}
            </span>
          </div>
        </div>
        {action.description && (
          <p className="text-xs dark:text-zinc-400 text-zinc-500 leading-relaxed mb-2">
            {action.description}
          </p>
        )}
        <p className="text-xs dark:text-zinc-500 text-zinc-400 italic mb-2">
          {action.rationale}
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          {action.when && (
            <span className="inline-flex items-center gap-1 text-xs dark:text-zinc-500 text-zinc-400">
              <Clock className="w-3 h-3" />
              {action.when.replace('_', ' ')}
            </span>
          )}
          {action.duration_minutes && (
            <span className="inline-flex items-center gap-1 text-xs dark:text-zinc-500 text-zinc-400">
              {action.duration_minutes}min
            </span>
          )}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${effortColor}`}>
            {action.effort_level} effort
          </span>
        </div>
      </div>
    </div>
  );
}
