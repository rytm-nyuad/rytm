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
import { Zap, Target, RefreshCw, AlertCircle, Loader2, Sparkles, ArrowRight, ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import Link from "next/link";

type PageState = "loading" | "no-goal" | "no-checkin" | "no-plan" | "generating" | "plan-ready";

function getTodayLocal() {
  return new Date().toISOString().split("T")[0];
}

function formatDateLabel(dateStr: string): string {
  const today = getTodayLocal();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (dateStr === today) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
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
      setPlan({
        plan_id: data.plan_id,
        morning_message: data.morning_message,
        for_date: selectedDate,
        selected_domains: data.debug?.selected_domains || [],
        actions: data.actions || [],
      });
      setEnergyMode(data.debug?.energy_mode);
      setPageState("plan-ready");
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

  const handleDateChange = (direction: "prev" | "next") => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + (direction === "next" ? 1 : -1));
    const newDate = d.toISOString().split("T")[0];
    if (newDate <= today) {
      setSelectedDate(newDate);
    }
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
        <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
          {/* Goal Banner */}
          <GoalBanner
            goal={goal}
            onSetGoal={() => setShowGoalModal(true)}
            onRegenerate={handleGeneratePlan}
            isGenerating={generating}
            planExists={pageState === "plan-ready"}
          />

          {/* Morning Summary Section */}
          <section>
            {/* Section header with date picker */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold dark:text-zinc-500 text-zinc-400 uppercase tracking-widest">
                Morning Summary
              </h2>
              <DatePicker
                selectedDate={selectedDate}
                today={today}
                onPrev={() => handleDateChange("prev")}
                onNext={() => handleDateChange("next")}
                onDateChange={setSelectedDate}
              />
            </div>

            {pageState === "loading" && <LoadingSkeleton />}

            {pageState === "no-goal" && (
              <EmptyState
                icon={Target}
                title="No goal set yet"
                description="Set a goal to unlock your personalized morning plans and action recommendations."
                action={
                  <button
                    onClick={() => setShowGoalModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
                  >
                    <Target className="w-4 h-4" />
                    Set Your Goal
                  </button>
                }
              />
            )}

            {pageState === "no-checkin" && (
              <EmptyState
                icon={AlertCircle}
                title={selectedDate === today ? "Complete today's check-in first" : `No check-in for ${formatDateLabel(selectedDate)}`}
                description={
                  selectedDate === today
                    ? "Log your daily overall score on the dashboard to unlock your morning plan."
                    : "No overall score was logged for this date. Try a different date or go back to the dashboard."
                }
                action={
                  selectedDate === today ? (
                    <Link
                      href="/dashboard"
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
                    >
                      Go to Dashboard
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  ) : (
                    <button
                      onClick={() => setSelectedDate(today)}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
                    >
                      Go to Today
                    </button>
                  )
                }
              />
            )}

            {(pageState === "no-plan" || pageState === "generating") && (
              <EmptyState
                icon={Sparkles}
                title={`No plan for ${formatDateLabel(selectedDate)} yet`}
                description="Generate your personalized morning brief and action plan."
                action={
                  <button
                    onClick={handleGeneratePlan}
                    disabled={generating}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating... (~30s)
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate Plan
                      </>
                    )}
                  </button>
                }
                error={generateError}
              />
            )}

            {pageState === "plan-ready" && plan && (
              <MorningSummaryCard plan={plan} energyMode={energyMode} />
            )}
          </section>

          {/* Coach Chat Section */}
          <section>
            <h2 className="text-xs font-semibold dark:text-zinc-500 text-zinc-400 uppercase tracking-widest mb-3">
              Coach Chat
            </h2>
            <CoachChatPanel userId={userId} firstName={firstName} />
          </section>
        </div>
      </div>

      {showGoalModal && (
        <GoalInterviewModal onClose={() => setShowGoalModal(false)} onGoalCreated={handleGoalCreated} />
      )}
    </ThemeProvider>
  );
}

function DatePicker({
  selectedDate,
  today,
  onPrev,
  onNext,
  onDateChange,
}: {
  selectedDate: string;
  today: string;
  onPrev: () => void;
  onNext: () => void;
  onDateChange: (date: string) => void;
}) {
  const isToday = selectedDate === today;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onPrev}
        className="p-1.5 rounded-lg dark:hover:bg-zinc-800 hover:bg-zinc-200 transition-colors"
      >
        <ChevronLeft className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
      </button>

      <div className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5 dark:text-zinc-500 text-zinc-400" />
        <input
          type="date"
          value={selectedDate}
          max={today}
          onChange={(e) => {
            if (e.target.value && e.target.value <= today) {
              onDateChange(e.target.value);
            }
          }}
          className="text-xs font-medium dark:text-zinc-300 text-zinc-600 bg-transparent border-none focus:outline-none cursor-pointer"
        />
        {isToday && (
          <span className="text-xs px-1.5 py-0.5 rounded-full dark:bg-violet-500/20 bg-violet-100 dark:text-violet-400 text-violet-600 font-medium">
            Today
          </span>
        )}
      </div>

      <button
        onClick={onNext}
        disabled={isToday}
        className="p-1.5 rounded-lg dark:hover:bg-zinc-800 hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <ChevronRight className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
      </button>
    </div>
  );
}

function GoalBanner({
  goal,
  onSetGoal,
  onRegenerate,
  isGenerating,
  planExists,
}: {
  goal: ActiveGoal | null;
  onSetGoal: () => void;
  onRegenerate: () => void;
  isGenerating: boolean;
  planExists: boolean;
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
            {planExists && (
              <button
                onClick={onRegenerate}
                disabled={isGenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium dark:text-zinc-400 text-zinc-500 dark:hover:bg-zinc-800 hover:bg-zinc-100 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                Regenerate
              </button>
            )}
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

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  error,
}: {
  icon: any;
  title: string;
  description: string;
  action: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 text-center px-6">
      <div className="w-12 h-12 rounded-2xl dark:bg-zinc-800 bg-zinc-100 flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 dark:text-zinc-400 text-zinc-500" />
      </div>
      <h3 className="text-base font-semibold dark:text-white text-zinc-900 mb-1">{title}</h3>
      <p className="text-sm dark:text-zinc-500 text-zinc-400 max-w-xs mb-5">{description}</p>
      {action}
      {error && <p className="mt-4 text-xs text-red-400 max-w-xs">{error}</p>}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-48 rounded-2xl dark:bg-zinc-900 bg-zinc-100" />
      <div className="h-20 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
      <div className="h-20 rounded-xl dark:bg-zinc-900 bg-zinc-100" />
    </div>
  );
}
