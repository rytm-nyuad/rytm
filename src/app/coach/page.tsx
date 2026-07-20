"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { TopNav } from "@/components/dashboard/TopNav";
import { MorningSummaryCard } from "@/components/coach/MorningSummaryCard";
import { GoalInterviewModal } from "@/components/coach/GoalInterviewModal";
import { CoachChatPanel } from "@/components/coach/CoachChatPanel";
import { ActiveGoal, DailyPlan } from "@/lib/coach/types";
import type { CoachReadiness } from "@/lib/coach/readiness";
import { CalendarPicker } from "@/components/coach/CalendarPicker";
import { Zap, Target, Loader2, Sparkles, ArrowRight, CheckCircle2, Circle, ClipboardList } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

type PageState = "loading" | "no-goal" | "no-checkin" | "no-plan" | "generating" | "plan-ready";

function getTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateStr: string): string {
  const today = getTodayLocal();
  const [y, m, d] = dateStr.split("-").map(Number);
  const selected = new Date(y, m - 1, d);
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  if (dateStr === today) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return selected.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function CoachPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("there");
  const [selectedDate, setSelectedDate] = useState(getTodayLocal());
  const [pageState, setPageState] = useState<PageState>("loading");
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [goal, setGoal] = useState<ActiveGoal | null>(null);
  const [energyMode, setEnergyMode] = useState<string | undefined>(undefined);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<CoachReadiness | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const today = getTodayLocal();

  // Auth check
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/sign-in");
        return;
      }
      setUserId(user.id);
      const displayName =
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split("@")[0] ||
        "there";
      setFirstName(displayName.split(" ")[0]);
    };
    init();
  }, []);

  const loadCoachData = useCallback(async () => {
    if (!userId) return;
    setPageState("loading");
    setPlan(null);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/coach/plan?forDate=${selectedDate}`);
      const data = await res.json();

      setGoal(data.goal || null);
      setPlan(data.plan || null);
      setReadiness(data.readiness || null);

      if (!data.hasGoal) {
        setPageState("no-goal");
      } else if (!data.plan) {
        // Check if there's an overall score for the selected date
        const { data: overallData } = await supabase
          .from("daily_overall")
          .select("id")
          .eq("user_id", userId)
          .eq("date", selectedDate)
          .maybeSingle();

        if (!overallData) {
          setPageState("no-checkin");
        } else {
          setPageState("no-plan");
        }
      } else {
        setPageState("plan-ready");
      }
    } catch (err) {
      console.error("Failed to load coach data:", err);
      setPageState("no-plan");
    }
  }, [userId, selectedDate]);

  useEffect(() => {
    if (userId) loadCoachData();
  }, [userId, loadCoachData]);

  const handleGeneratePlan = async () => {
    setGenerating(true);
    setGenerateError(null);
    setPageState("generating");
    try {
      const res = await fetch("/api/coach/morning-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forDate: selectedDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerateError(data.error || "Failed to generate plan");
        setPageState("no-plan");
        return;
      }
      if (data.status && data.status !== "ok") {
        const blockerHint = Array.isArray(data.readiness?.blockers)
          ? ` Blockers: ${data.readiness.blockers.join(", ")}.`
          : "";
        setGenerateError((data.message || `Generation stopped (${data.status}).`) + blockerHint);
        if (data.readiness) setReadiness(data.readiness);
        setPageState("no-plan");
        return;
      }
      setEnergyMode(data.debug?.energy_mode);
      await loadCoachData();
    } catch (err: any) {
      setGenerateError(err.message || "Something went wrong");
      setPageState("no-plan");
    } finally {
      setGenerating(false);
    }
  };

  const handleGoalCreated = () => {
    setShowGoalModal(false);
    loadCoachData();
  };


  if (!userId) {
    return (
      <ThemeProvider>
        <div className="min-h-screen dark:bg-black bg-zinc-50 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin dark:text-zinc-400 text-zinc-500" />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen dark:bg-black bg-zinc-50">
        <TopNav />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          {/* Goal Banner */}
          <GoalBanner
            goal={goal}
            onSetGoal={() => setShowGoalModal(true)}
          />

          {/* Morning Summary Section */}
          <section>
            {/* Section header with date picker */}
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-md shadow-violet-500/25 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-violet-700 dark:text-violet-300">
                      Morning Summary
                    </h2>
                    <p className="mt-0.5 text-sm dark:text-zinc-400 text-zinc-500">
                      Your brief &amp; plan for the day
                    </p>
                  </div>
                </div>
                {pageState === "plan-ready" && plan && (
                  <p className="mt-3 text-sm leading-relaxed dark:text-zinc-400 text-zinc-500 max-w-2xl">
                    Saved brief for {formatDateLabel(plan.for_date)}. Use the calendar to revisit prior mornings, or regenerate this date if you want a fresh run.
                  </p>
                )}
              </div>
              <CalendarPicker
                selectedDate={selectedDate}
                maxDate={today}
                onDateChange={setSelectedDate}
              />
            </div>

            {pageState === "loading" && <LoadingSkeleton />}

            {pageState === "no-goal" && (
              <CoachPromptCard
                tone="goal"
                icon={Target}
                eyebrow="Almost ready"
                title="Set a goal to unlock coaching"
                description="Your morning brief and actions are personalized around an active goal. Take a minute to set one, then come back to generate today’s plan."
                steps={[
                  { label: "Set your goal", done: false, current: true },
                  { label: "Log morning overall score", done: false },
                  { label: "Generate morning plan", done: false },
                ]}
                action={
                  <button
                    onClick={() => setShowGoalModal(true)}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-base font-semibold shadow-lg shadow-violet-500/25 transition-colors"
                  >
                    <Target className="w-4 h-4" />
                    Set Your Goal
                  </button>
                }
              />
            )}

            {pageState === "no-checkin" && (
              <CoachPromptCard
                tone="checkin"
                icon={ClipboardList}
                eyebrow={selectedDate === today ? "Step 1 of 2" : "Missing check-in"}
                title={
                  selectedDate === today
                    ? "Log today’s overall score first"
                    : `No check-in for ${formatDateLabel(selectedDate)}`
                }
                description={
                  selectedDate === today
                    ? "Your morning coach needs today’s overall score before it can write a brief and pick actions. Submit it on the dashboard, then return here to generate your plan."
                    : "No overall score was logged for this date. Pick another day from the calendar, or jump back to today."
                }
                steps={
                  selectedDate === today
                    ? [
                        { label: "Log morning overall score", done: false, current: true },
                        { label: "Generate morning plan", done: false },
                      ]
                    : undefined
                }
                highlights={
                  selectedDate === today
                    ? [
                        "Takes under a minute on the dashboard",
                        "Unlocks sleep, recovery, and mood context for coaching",
                        "Required before Generate Plan becomes available",
                      ]
                    : undefined
                }
                action={
                  selectedDate === today ? (
                    <Link
                      href="/dashboard"
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-base font-semibold shadow-lg shadow-violet-500/25 transition-colors"
                    >
                      Go to Dashboard
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  ) : (
                    <button
                      onClick={() => setSelectedDate(today)}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-base font-semibold shadow-lg shadow-violet-500/25 transition-colors"
                    >
                      Go to Today
                    </button>
                  )
                }
              />
            )}

            {(pageState === "no-plan" || pageState === "generating") && (
              <CoachPromptCard
                tone="generate"
                icon={Sparkles}
                eyebrow={generating ? "Working on it" : "Ready to generate"}
                title={
                  generating
                    ? `Building your plan for ${formatDateLabel(selectedDate)}…`
                    : `No plan for ${formatDateLabel(selectedDate)} yet`
                }
                description={
                  generating
                    ? "Pulling together last night’s recovery, yesterday’s signals, and your goal. This usually takes about 30 seconds."
                    : "Everything needed is in place. Generate a personalized morning brief and today’s action list — prior mornings stay available from the calendar."
                }
                steps={[
                  { label: "Goal set", done: true },
                  { label: "Overall score logged", done: true },
                  {
                    label: generating ? "Generating morning plan…" : "Generate morning plan",
                    done: false,
                    current: true,
                  },
                ]}
                highlights={
                  generating
                    ? undefined
                    : [
                        "A scannable morning brief with key numbers highlighted",
                        "2–3 concrete actions you can check off through the day",
                        "Grounded in your wearables, check-in, and active goal",
                      ]
                }
                action={
                  <button
                    onClick={handleGeneratePlan}
                    disabled={generating}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-70 disabled:cursor-not-allowed text-white text-base font-semibold shadow-lg shadow-violet-500/25 transition-colors"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generating… (~30s)
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        Generate Plan
                      </>
                    )}
                  </button>
                }
                error={generateError}
                readiness={readiness}
              />
            )}

            {pageState === "plan-ready" && plan && (
              <MorningSummaryCard
                plan={plan}
                energyMode={energyMode || plan.energy_mode || undefined}
                readiness={readiness}
                onRegenerate={handleGeneratePlan}
                isRegenerating={generating}
                onActionsChange={(actions) =>
                  setPlan((prev) => (prev ? { ...prev, actions } : prev))
                }
              />
            )}
          </section>

          {/* Coach Chat Section */}
          {/* <section> */}
            {/* <h2 className="text-xs font-semibold dark:text-zinc-500 text-zinc-400 uppercase tracking-widest mb-3"> */}
              {/* Coach Chat */}
            {/* </h2> */}
            {/* <CoachChatPanel userId={userId} firstName={firstName} /> */}
          {/* </section> */}
        </div>
      </div>

      {showGoalModal && (
        <GoalInterviewModal onClose={() => setShowGoalModal(false)} onGoalCreated={handleGoalCreated} />
      )}
    </ThemeProvider>
  );
}


function GoalBanner({
  goal,
  onSetGoal,
}: {
  goal: ActiveGoal | null;
  onSetGoal: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
          <Target className="w-4 h-4 text-white" />
        </div>
        {goal ? (
          <div>
            <p className="text-xs dark:text-zinc-500 text-zinc-400">Active Goal</p>
            <p className="text-sm font-semibold dark:text-white text-zinc-900">{goal.title}</p>
          </div>
        ) : (
          <p className="text-sm font-medium dark:text-zinc-400 text-zinc-500">No active goal</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {goal ? (
          <>
            <button
              onClick={onSetGoal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium dark:text-zinc-300 text-zinc-700 dark:bg-zinc-800 bg-zinc-100 dark:hover:bg-zinc-700 hover:bg-zinc-200 transition-colors"
            >
              Change Goal
            </button>
          </>
        ) : (
          <button
            onClick={onSetGoal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-violet-600 hover:bg-violet-500 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            Set Goal
          </button>
        )}
      </div>
    </div>
  );
}

const BLOCKER_COPY: Record<string, string> = {
  no_active_goal: "No active goal set. Set or update your goal to personalize plans.",
  no_daily_overall: "No daily check-in score for this date.",
  no_input_bundle: "Coach inputs for this date are still being prepared.",
  no_state_history: "State history for this date is not ready yet.",
  fast_baseline_not_ready: "Personal baseline is still warming up (early history).",
};

function ReadinessIndicator({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border dark:border-zinc-800 border-zinc-200 bg-white/60 dark:bg-zinc-950/60 px-3.5 py-2.5">
      <span className="text-sm dark:text-zinc-300 text-zinc-700">{label}</span>
      <span
        className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
          ok
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        }`}
      >
        {ok ? "Ready" : "Missing"}
      </span>
    </div>
  );
}

function ReadinessDetails({ readiness }: { readiness: CoachReadiness }) {
  const blockers = readiness.blockers?.length
    ? readiness.blockers.map((code) => BLOCKER_COPY[code] || code.replaceAll("_", " "))
    : [];

  return (
    <details className="mt-2 w-full text-left group">
      <summary className="cursor-pointer text-sm font-medium text-violet-700 dark:text-violet-300 list-none flex items-center gap-2">
        <span className="underline-offset-2 group-open:underline">Why can&apos;t I generate yet?</span>
        <span className="text-xs dark:text-zinc-500 text-zinc-400 font-normal">Tap for details</span>
      </summary>
      <div className="mt-3 rounded-xl dark:bg-zinc-950/80 bg-zinc-50/80 border dark:border-zinc-800 border-zinc-200 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ReadinessIndicator label="Goal set" ok={readiness.hasGoal} />
          <ReadinessIndicator label="Check-in score logged" ok={readiness.hasOverall} />
          <ReadinessIndicator label="Inputs prepared" ok={readiness.hasBundle} />
          <ReadinessIndicator label="State history ready" ok={readiness.hasStateHistory} />
        </div>

        <div className="rounded-xl border dark:border-zinc-800 border-zinc-200 px-3.5 py-2.5">
          <p className="text-sm font-medium dark:text-zinc-300 text-zinc-700">Baseline status</p>
          <p className="mt-1 text-sm dark:text-zinc-400 text-zinc-600">
            Fast baseline: <span className="font-semibold">{readiness.fast_ready ? "Ready" : "Warming up"}</span>
            {" · "}
            Slow baseline: <span className="font-semibold">{readiness.slow_ready ? "Ready" : "Warming up"}</span>
          </p>
        </div>

        {blockers.length > 0 ? (
          <div className="rounded-xl border dark:border-zinc-800 border-zinc-200 px-3.5 py-2.5">
            <p className="text-sm font-medium dark:text-zinc-300 text-zinc-700">What is blocking generation</p>
            <ul className="mt-1.5 space-y-1 text-sm dark:text-zinc-400 text-zinc-600 list-disc pl-4">
              {blockers.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm dark:text-zinc-400 text-zinc-600">
            No blockers detected. Try generating again if this date should have a plan.
          </p>
        )}
      </div>
    </details>
  );
}

type PromptStep = {
  label: string;
  done?: boolean;
  current?: boolean;
};

function CoachPromptCard({
  tone,
  icon: Icon,
  eyebrow,
  title,
  description,
  steps,
  highlights,
  action,
  error,
  readiness,
}: {
  tone: "goal" | "checkin" | "generate";
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  steps?: PromptStep[];
  highlights?: string[];
  action: React.ReactNode;
  error?: string | null;
  readiness?: CoachReadiness | null;
}) {
  const accent =
    tone === "checkin"
      ? "from-amber-500 to-orange-500"
      : tone === "generate"
        ? "from-violet-500 to-indigo-600"
        : "from-violet-500 to-purple-600";

  return (
    <div className="relative overflow-hidden rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200">
      <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${accent}`} />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-500/10 via-transparent to-transparent" />

      <div className="relative grid grid-cols-1 lg:grid-cols-5 gap-0">
        <div className="lg:col-span-3 p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-4">
            <div
              className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${accent} shadow-lg shadow-violet-500/20 flex items-center justify-center flex-shrink-0`}
            >
              <Icon className="w-7 h-7 text-white" />
            </div>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                {eyebrow}
              </p>
              <h3 className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-violet-800 dark:text-violet-200">
                {title}
              </h3>
            </div>
          </div>

          <p className="text-base leading-relaxed dark:text-zinc-300 text-zinc-600 max-w-xl">
            {description}
          </p>

          {steps && steps.length > 0 && (
            <ol className="space-y-2.5 max-w-md">
              {steps.map((step, index) => (
                <li
                  key={step.label}
                  className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 border ${
                    step.current
                      ? "border-violet-400/40 bg-violet-500/10 dark:bg-violet-500/10"
                      : "border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/40"
                  }`}
                >
                  {step.done ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  ) : step.current ? (
                    <div className="w-5 h-5 rounded-full border-2 border-violet-500 flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-violet-500" />
                    </div>
                  ) : (
                    <Circle className="w-5 h-5 text-zinc-400 dark:text-zinc-600 flex-shrink-0" />
                  )}
                  <span
                    className={`text-sm font-medium ${
                      step.done
                        ? "text-emerald-700 dark:text-emerald-400"
                        : step.current
                          ? "text-violet-800 dark:text-violet-200"
                          : "dark:text-zinc-500 text-zinc-500"
                    }`}
                  >
                    <span className="mr-1.5 tabular-nums opacity-70">{index + 1}.</span>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            {action}
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300 max-w-xl">
              {error}
            </div>
          )}

          {readiness && <ReadinessDetails readiness={readiness} />}
        </div>

        <div className="lg:col-span-2 border-t lg:border-t-0 lg:border-l dark:border-zinc-800 border-zinc-200 p-6 sm:p-8 dark:bg-zinc-950/50 bg-zinc-50/70">
          <p className="text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 mb-4">
            {highlights?.length ? "What you get" : "Quick tip"}
          </p>
          {highlights && highlights.length > 0 ? (
            <ul className="space-y-3">
              {highlights.map((item) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed dark:text-zinc-300 text-zinc-600">
                  <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3 text-sm leading-relaxed dark:text-zinc-400 text-zinc-600">
              <p>
                Use the calendar above to revisit mornings you already generated — each date keeps its own brief and actions.
              </p>
              {tone === "generate" && (
                <p className="rounded-xl border dark:border-zinc-800 border-zinc-200 bg-white dark:bg-zinc-900 px-3.5 py-3">
                  Tip: leave this tab open while generating. When it finishes, your two-column overview and today&apos;s plan will appear here.
                </p>
              )}
            </div>
          )}

          {/* Decorative preview of the ready layout */}
          <div className="mt-6 grid grid-cols-2 gap-2 opacity-70">
            <div className="rounded-lg border dark:border-zinc-800 border-zinc-200 bg-white dark:bg-zinc-900 p-3 space-y-2">
              <div className="h-2 w-16 rounded bg-violet-300/50 dark:bg-violet-500/30" />
              <div className="h-8 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-16 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
            <div className="rounded-lg border dark:border-zinc-800 border-zinc-200 bg-white dark:bg-zinc-900 p-3 space-y-2">
              <div className="h-2 w-14 rounded bg-violet-300/50 dark:bg-violet-500/30" />
              <div className="h-10 rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-10 rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-pulse">
      <div className="space-y-3">
        <div className="h-8 w-48 rounded-lg dark:bg-zinc-900 bg-zinc-100" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-20 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
          <div className="h-20 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
        </div>
        <div className="h-64 rounded-2xl dark:bg-zinc-900 bg-zinc-100" />
      </div>
      <div className="space-y-3">
        <div className="h-8 w-40 rounded-lg dark:bg-zinc-900 bg-zinc-100" />
        <div className="h-28 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
        <div className="h-24 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
        <div className="h-24 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
      </div>
    </div>
  );
}
