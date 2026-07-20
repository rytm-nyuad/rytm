"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ActionRatingValue, CoachAction, DailyPlan } from "@/lib/coach/types";
import type { CoachReadiness } from "@/lib/coach/readiness";
import {
  Zap,
  Droplets,
  Moon,
  Brain,
  Activity,
  Target,
  Flame,
  Clock,
  RefreshCw,
  Check,
  AlertTriangle,
  Star,
  X,
} from "lucide-react";
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
  sleep: "text-indigo-600 bg-indigo-500/10 dark:text-indigo-300",
  recovery: "text-violet-600 bg-violet-500/10 dark:text-violet-300",
  hydration: "text-blue-600 bg-blue-500/10 dark:text-blue-300",
  nutrition: "text-orange-600 bg-orange-500/10 dark:text-orange-300",
  stress: "text-rose-600 bg-rose-500/10 dark:text-rose-300",
  focus: "text-violet-600 bg-violet-500/10 dark:text-violet-300",
  training: "text-green-600 bg-green-500/10 dark:text-green-300",
  stability: "text-cyan-600 bg-cyan-500/10 dark:text-cyan-300",
  productivity: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
};

const EFFORT_COLORS: Record<string, string> = {
  low: "text-emerald-700 bg-emerald-500/10 dark:text-emerald-300",
  medium: "text-amber-700 bg-amber-500/10 dark:text-amber-300",
  high: "text-rose-700 bg-rose-500/10 dark:text-rose-300",
};

const RATING_OPTIONS: { value: ActionRatingValue; label: string }[] = [
  { value: 1, label: "1 — Not helpful" },
  { value: 2, label: "2 — Slightly helpful" },
  { value: 3, label: "3 — Somewhat helpful" },
  { value: 4, label: "4 — Helpful" },
  { value: 5, label: "5 — Very helpful" },
];

const MAX_COMMENT_LEN = 2000;

interface MorningSummaryCardProps {
  plan: DailyPlan;
  energyMode?: string;
  readiness?: CoachReadiness | null;
  onRegenerate?: () => void;
  isRegenerating?: boolean;
  onActionsChange?: (actions: CoachAction[]) => void;
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

function formatCompletedAt(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MorningSummaryCard({
  plan,
  energyMode,
  readiness,
  onRegenerate,
  isRegenerating = false,
  onActionsChange,
}: MorningSummaryCardProps) {
  const generatedAt = formatGeneratedAt(plan.updated_at);
  const resolvedEnergy = energyMode || plan.energy_mode || undefined;
  const [actions, setActions] = useState(plan.actions);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [ratingActionId, setRatingActionId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Keep local actions in sync when parent reloads a different plan/date.
  useEffect(() => {
    setActions(plan.actions);
    setToggleError(null);
    setRatingActionId(null);
    // Intentionally only when the plan identity changes — not on every actions array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.plan_id, plan.for_date]);

  const completedCount = actions.filter((a) => !!a.user_completed_at).length;
  const totalCount = actions.length;
  const primary = actions[0];
  const secondary = actions.slice(1);
  const ratingAction = ratingActionId
    ? actions.find((a) => a.action_id === ratingActionId) ?? null
    : null;

  const dataQualityNotes = useMemo(() => {
    if (!readiness) return [];
    const notes: string[] = [];
    if (!readiness.fast_ready) {
      notes.push("Personal baselines are still warming up — today’s brief uses absolute observations.");
    }
    if (!readiness.hasBundle) {
      notes.push("Some coach inputs may still be incomplete for this date.");
    }
    return notes;
  }, [readiness]);

  const handleToggle = async (action: CoachAction) => {
    const nextCompleted = !action.user_completed_at;
    setToggleError(null);
    setPendingId(action.action_id);

    // Optimistic update
    const optimistic = actions.map((a) =>
      a.action_id === action.action_id
        ? {
            ...a,
            user_completed_at: nextCompleted ? new Date().toISOString() : null,
          }
        : a
    );
    setActions(optimistic);

    try {
      const res = await fetch("/api/coach/actions/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forDate: plan.for_date,
          actionId: action.action_id,
          completed: nextCompleted,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update");
      }
      startTransition(() => {
        setActions(data.actions);
        onActionsChange?.(data.actions);
      });
    } catch (err: any) {
      setActions(plan.actions);
      setToggleError(err?.message || "Could not save completion");
    } finally {
      setPendingId(null);
    }
  };

  const handleRate = async (
    action: CoachAction,
    ratingValue: ActionRatingValue,
    comment: string
  ) => {
    setToggleError(null);
    setPendingId(action.action_id);

    try {
      const res = await fetch("/api/coach/actions/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          forDate: plan.for_date,
          planId: plan.plan_id,
          actionId: action.action_id,
          ratingValue,
          comment: comment.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save rating");
      }
      startTransition(() => {
        setActions(data.actions);
        onActionsChange?.(data.actions);
      });
      setRatingActionId(null);
    } catch (err: any) {
      setToggleError(err?.message || "Could not save rating");
      throw err;
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {ratingAction && (
        <ActionRatingModal
          action={ratingAction}
          busy={pendingId === ratingAction.action_id}
          onClose={() => setRatingActionId(null)}
          onRate={(rating, comment) => handleRate(ratingAction, rating, comment)}
        />
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
        {/* Left: morning overview */}
        <div className="space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold tracking-tight text-violet-700 dark:text-violet-300">
              Morning overview
            </h3>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
                Regenerate
              </button>
            )}
          </div>

          {/* Score / status cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 px-4 py-3">
              <p className="text-sm font-medium dark:text-zinc-400 text-zinc-500">Morning score</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums dark:text-white text-zinc-900">
                {typeof plan.overall_score === "number" ? plan.overall_score : "—"}
              </p>
            </div>
            <div className="rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 px-4 py-3">
              <p className="text-sm font-medium dark:text-zinc-400 text-zinc-500">Energy mode</p>
              <p className="mt-1 text-2xl font-semibold dark:text-white text-zinc-900">
                {resolvedEnergy ? capitalize(resolvedEnergy) : "—"}
              </p>
            </div>
          </div>

          {dataQualityNotes.length > 0 && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <ul className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
                {dataQualityNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.morning_message ? (
            <div className="rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 px-5 py-4 text-sm leading-relaxed dark:text-zinc-300 text-zinc-700 space-y-3">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h2 className="text-xl font-semibold tracking-tight text-violet-700 dark:text-violet-300 mt-1 mb-2">
                      {children}
                    </h2>
                  ),
                  h2: ({ children }) => (
                    <h3 className="text-lg font-semibold tracking-tight text-violet-700 dark:text-violet-300 mt-3 mb-1.5 first:mt-0">
                      {children}
                    </h3>
                  ),
                  h3: ({ children }) => (
                    <h4 className="text-base font-semibold tracking-tight text-violet-700 dark:text-violet-300 mt-2.5 mb-1">
                      {children}
                    </h4>
                  ),
                  h4: ({ children }) => (
                    <h5 className="text-sm font-semibold tracking-tight text-violet-700 dark:text-violet-300 mt-2 mb-1">
                      {children}
                    </h5>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm leading-relaxed dark:text-zinc-300 text-zinc-700 mb-2 last:mb-0">
                      {children}
                    </p>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-violet-800 dark:text-violet-200">
                      {children}
                    </strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-violet-700/90 dark:text-violet-300/90">
                      {children}
                    </em>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc pl-5 space-y-1 mb-2 text-sm dark:text-zinc-300 text-zinc-700">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-5 space-y-1 mb-2 text-sm dark:text-zinc-300 text-zinc-700">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="leading-relaxed marker:text-violet-500 dark:marker:text-violet-400">
                      {children}
                    </li>
                  ),
                }}
              >
                {plan.morning_message}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 px-5 py-4 text-sm dark:text-zinc-400 text-zinc-500">
              No morning brief for this date.
            </div>
          )}

          {generatedAt && (
            <p className="text-xs dark:text-zinc-500 text-zinc-400">
              Plan updated {generatedAt}
            </p>
          )}
        </div>

        {/* Right: actions */}
        <div className="space-y-4 min-w-0">
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-violet-700 dark:text-violet-300">
              Today&apos;s actions
            </h3>
            {totalCount > 0 && (
              <div className="mt-2 flex items-center gap-3">
                <p className="text-sm dark:text-zinc-400 text-zinc-500">
                  {completedCount} of {totalCount} complete
                </p>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden max-w-[140px]">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{
                      width: `${Math.round((completedCount / Math.max(totalCount, 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {totalCount === 0 ? (
            <div className="rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-5 text-sm dark:text-zinc-400 text-zinc-500">
              No actions for this morning yet.
            </div>
          ) : (
            <div className="space-y-3">
              {primary && (
                <div className="space-y-2">
                  <p className="text-sm font-medium dark:text-zinc-400 text-zinc-500 px-0.5">
                    Primary
                  </p>
                  <ActionCard
                    action={primary}
                    isPrimary
                    busy={pendingId === primary.action_id}
                    onToggle={() => handleToggle(primary)}
                    onOpenRating={() => setRatingActionId(primary.action_id)}
                  />
                </div>
              )}
              {secondary.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium dark:text-zinc-400 text-zinc-500 px-0.5">
                    Also today
                  </p>
                  {secondary.map((action) => (
                    <ActionCard
                      key={action.action_id}
                      action={action}
                      busy={pendingId === action.action_id}
                      onToggle={() => handleToggle(action)}
                      onOpenRating={() => setRatingActionId(action.action_id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {toggleError && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{toggleError}</p>
          )}

          <p className="text-sm leading-relaxed dark:text-zinc-400 text-zinc-500">
            These suggestions are for general wellness support and are not medical advice.
          </p>
        </div>
      </div>
    </div>
  );
}

function ActionCard({
  action,
  isPrimary = false,
  busy,
  onToggle,
  onOpenRating,
}: {
  action: CoachAction;
  isPrimary?: boolean;
  busy: boolean;
  onToggle: () => void;
  onOpenRating: () => void;
}) {
  const Icon = DOMAIN_ICONS[action.domain] || Target;
  const domainColor = DOMAIN_COLORS[action.domain] || "text-zinc-600 bg-zinc-500/10 dark:text-zinc-300";
  const effortColor = EFFORT_COLORS[action.effort_level] || EFFORT_COLORS.medium;
  const done = !!action.user_completed_at;
  const completedLabel = formatCompletedAt(action.user_completed_at);
  const hasRating = action.user_rating?.rating_value_num != null;

  return (
    <div
      className={`flex gap-3 rounded-xl border p-4 transition-colors ${
        done
          ? "dark:bg-zinc-900/70 bg-zinc-50 dark:border-emerald-900/50 border-emerald-200"
          : "dark:bg-zinc-900 bg-white dark:border-zinc-800 border-zinc-200 hover:dark:border-zinc-700 hover:border-zinc-300"
      } ${isPrimary ? "ring-1 ring-violet-500/20" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={done}
        aria-label={done ? `Mark "${action.title}" incomplete` : `Mark "${action.title}" complete`}
        className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors disabled:opacity-60 ${
          done
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-zinc-300 dark:border-zinc-600 hover:border-emerald-500 dark:hover:border-emerald-400"
        }`}
      >
        {done ? <Check className="w-4 h-4" strokeWidth={3} /> : null}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h4
            className={`text-lg font-semibold leading-snug ${
              done
                ? "line-through text-violet-400/70 dark:text-violet-400/50"
                : "text-violet-800 dark:text-violet-200"
            }`}
          >
            {action.title}
          </h4>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              type="button"
              onClick={onOpenRating}
              disabled={busy}
              title={hasRating ? "Edit rating" : "Rate this action"}
              aria-label={
                hasRating
                  ? `Edit rating for "${action.title}"`
                  : `Rate "${action.title}"`
              }
              className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border transition-colors disabled:opacity-60 ${
                hasRating
                  ? "border-amber-400/70 bg-amber-100 text-amber-700 hover:bg-amber-200 dark:border-amber-500/50 dark:bg-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/30"
                  : "border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25"
              }`}
            >
              <Star
                className="w-3.5 h-3.5"
                fill={hasRating ? "currentColor" : "none"}
              />
            </button>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${domainColor}`}
            >
              <Icon className="w-3 h-3" />
              {action.domain}
            </span>
          </div>
        </div>

        {done && completedLabel ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-2">
            ✓ Completed at {completedLabel}
          </p>
        ) : null}

        {hasRating ? (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
            Rated {action.user_rating?.rating_value_num}/5
            {action.user_rating?.rating_value_text
              ? ` · ${action.user_rating.rating_value_text}`
              : ""}
          </p>
        ) : null}

        {action.description && (
          <p className="text-sm leading-relaxed dark:text-zinc-300 text-zinc-600 mb-2">
            {action.description}
          </p>
        )}
        {action.rationale && (
          <p className="text-sm leading-relaxed dark:text-zinc-400 text-zinc-500 mb-3">
            {action.rationale}
          </p>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          {action.when && (
            <span className="inline-flex items-center gap-1 text-sm dark:text-zinc-400 text-zinc-500">
              <Clock className="w-3.5 h-3.5" />
              {action.when.replace("_", " ")}
            </span>
          )}
          {action.duration_minutes && (
            <span className="inline-flex items-center gap-1 text-sm dark:text-zinc-400 text-zinc-500">
              {action.duration_minutes} min
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

function ActionRatingModal({
  action,
  busy,
  onClose,
  onRate,
}: {
  action: CoachAction;
  busy: boolean;
  onClose: () => void;
  onRate: (rating: ActionRatingValue, comment: string) => Promise<void>;
}) {
  const existingRating = action.user_rating?.rating_value_num ?? null;
  const existingComment = action.user_rating?.comment ?? "";
  const [ratingDraft, setRatingDraft] = useState<string>(
    existingRating != null ? String(existingRating) : ""
  );
  const [commentDraft, setCommentDraft] = useState(existingComment);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    setRatingDraft(existingRating != null ? String(existingRating) : "");
    setCommentDraft(existingComment);
    setSaveState("idle");
  }, [action.action_id, existingRating, existingComment]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty =
    ratingDraft !== (existingRating != null ? String(existingRating) : "") ||
    commentDraft.trim() !== (existingComment || "").trim();

  const handleSaveRating = async () => {
    const parsed = Number(ratingDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    try {
      await onRate(parsed as ActionRatingValue, commentDraft);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-rating-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/55 backdrop-blur-[2px]"
        aria-label="Close rating dialog"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-2xl border border-violet-200 dark:border-violet-500/30 bg-white dark:bg-zinc-900 shadow-2xl shadow-violet-950/20 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-violet-100 dark:border-violet-500/20 bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/40 dark:to-zinc-900">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">
              Rate action
            </p>
            <h4
              id="action-rating-title"
              className="mt-1 text-base font-semibold text-violet-900 dark:text-violet-100 leading-snug truncate"
            >
              {action.title}
            </h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block text-sm font-medium text-violet-800 dark:text-violet-200">
            How helpful was this?
            <div className="relative mt-1.5">
              <select
                value={ratingDraft}
                disabled={busy || saveState === "saving"}
                onChange={(e) => {
                  setRatingDraft(e.target.value);
                  setSaveState("idle");
                }}
                className="block w-full appearance-none rounded-xl border-2 border-violet-300 dark:border-violet-500/50 bg-violet-50 dark:bg-violet-950/50 px-3.5 py-2.5 pr-10 text-sm font-medium text-violet-900 dark:text-violet-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60"
              >
                <option value="">Select a rating</option>
                {RATING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-violet-500 dark:text-violet-300">
                <Star className="w-4 h-4" fill="currentColor" />
              </span>
            </div>
          </label>

          <label className="block text-sm font-medium text-violet-800 dark:text-violet-200">
            Comment (optional)
            <textarea
              value={commentDraft}
              disabled={busy || saveState === "saving"}
              maxLength={MAX_COMMENT_LEN}
              rows={3}
              placeholder="What worked or didn’t?"
              onChange={(e) => {
                setCommentDraft(e.target.value.slice(0, MAX_COMMENT_LEN));
                setSaveState("idle");
              }}
              className="mt-1.5 block w-full rounded-xl border-2 border-violet-200 dark:border-violet-500/40 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60 resize-y"
            />
          </label>

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 min-h-[1rem]">
              {saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Couldn’t save — try again"
                  : dirty
                    ? "Unsaved changes"
                    : existingRating != null
                      ? "Previously saved"
                      : " "}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center rounded-xl px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  saveState === "saving" ||
                  !ratingDraft ||
                  (!dirty && existingRating != null)
                }
                onClick={handleSaveRating}
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saveState === "saving"
                  ? "Saving…"
                  : existingRating != null
                    ? "Update"
                    : "Save rating"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
