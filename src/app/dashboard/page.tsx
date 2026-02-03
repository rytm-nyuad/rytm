"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createBrowserClient } from "@supabase/ssr";

import { ThemeProvider } from "@/contexts/ThemeContext";
import { OverallSliderCard } from "@/components/dashboard/OverallSliderCard";
import { StreakRing } from "@/components/dashboard/StreakRing";
import { WeeklyStreak } from "@/components/dashboard/WeeklyStreak";
import { ProgressList } from "@/components/dashboard/ProgressList";
import { LogMealModal } from "@/components/dashboard/LogMealModal";
import { LogWaterModal } from "@/components/dashboard/LogWaterModal";
import { DailyCheckInModal } from "@/components/dashboard/DailyCheckInModal";
import { JournalChat } from "@/components/dashboard/JournalChat";
import { CoachPromptBar } from "@/components/dashboard/CoachPromptBar";
import { FullScreenCoach } from "@/components/dashboard/FullScreenCoach";
//import { CoachChat } from "@/components/dashboard/CoachChat";
import { TopNav } from "@/components/dashboard/TopNav";
import { TodaysFocus } from "@/components/dashboard/TodaysFocus";
import { NudgeToast } from "@/components/dashboard/NudgeToast";
import { DashboardBackground } from "@/components/dashboard/DashboardBackground";

import {
  getTodayOverall,
  submitDailyOverall,
  getTodayMealsCount,
  hasWaterLoggedToday,
  hasCheckInToday,
  logMeal,
  logWater,
  submitDailyCheckIn,
  getWeeklyActivity,
} from "@/lib/db/dashboard";

import type { TodayProgress } from "@/types/dashboard";

export default function DashboardPage() {
  return (
    <ThemeProvider>
      <DashboardContent />
    </ThemeProvider>
  );
}

function DashboardContent() {
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("there");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [streak, setStreak] = useState(0);
  const [weeklyData, setWeeklyData] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const [progress, setProgress] = useState<TodayProgress>({
    overallQuestion: false,
    mealLogged: false,
    waterLogged: false,
    checkInCompleted: false,
    journalCompleted: false,
  });
  const [canonicalTz, setCanonicalTz] = useState<string>("UTC");

  const loadSeqRef = useRef(0);

  // Modal states
  const [showOverallModal, setShowOverallModal] = useState(false);
  const [showMealModal, setShowMealModal] = useState(false);
  const [showWaterModal, setShowWaterModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [journalAutoFocus, setJournalAutoFocus] = useState(false);
  const [initialCoachMessage, setInitialCoachMessage] = useState<string>("");
  const actionScreenRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const [showScrollArrow, setShowScrollArrow] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (userId) {
      loadDashboardData(userId, selectedDate);
    }
  }, [selectedDate, userId]);

  // Reload data when page becomes visible (user returns to tab)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && userId) {
        loadDashboardData(userId, selectedDate);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId, selectedDate]);

  const checkAuth = async () => {

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push("/sign-in");
      return;
    }

    // Check if user has signed consent form
    const { data: consentData } = await supabase
      .from("consent_signatures")
      .select("id")
      .eq("user_id", session.user.id)
      .maybeSingle(); // Use maybeSingle() to avoid error when no record

    if (!consentData) {
      // No consent signature found, redirect to consent page
      router.push("/consent");
      return;
    }

    setUserId(session.user.id);

    // Get first name - prefer user_metadata, fallback to profiles
    let name = session.user.user_metadata?.first_name;
    if (!name) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("first_name")
        .eq("id", session.user.id)
        .single();
      name = profile?.first_name;
    }
    setFirstName(name || "there");

    await loadDashboardData(session.user.id, new Date());
  };

  const loadDashboardData = async (userId: string, date: Date, opts?: { forceWeekly?: boolean }) => {
    const seq = ++loadSeqRef.current; // NEW request id

    // optional: show loading spinner only for first load, not every date change
    setLoading(true);

    // canonical tz + local comparisons
    const { getDashboardTimeZone, getDailySummaryForDate, getStreakData, getWeeklyActivity } =
      await import("@/lib/db/dashboard");

    const tz = await getDashboardTimeZone(userId);
    if (seq !== loadSeqRef.current) return; // ✅ guard
    setCanonicalTz(tz);

    const formatLocal = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);

    const selectedLocal = formatLocal(date);
    const todayLocal = formatLocal(new Date());

    // 1) selected day row (checklist)
    const dayRow = await getDailySummaryForDate(userId, date);
    if (seq !== loadSeqRef.current) return; // ✅ guard

    setProgress({
      overallQuestion: dayRow.has_overall,
      mealLogged: dayRow.has_meal,
      waterLogged: dayRow.has_water,
      checkInCompleted: dayRow.has_checkin,
      journalCompleted: dayRow.has_journal,
    });

    // 2) gate only for today
    setIsLocked(selectedLocal === todayLocal ? !dayRow.has_overall : false);

    // 3) streak + weekly only on today
    const forceWeekly = opts?.forceWeekly ?? false;
    
    if (selectedLocal === todayLocal|| forceWeekly) {
      const [streak, weekly] = await Promise.all([
        getStreakData(userId),
        getWeeklyActivity(userId),
      ]);
      if (seq !== loadSeqRef.current) return; // ✅ guard
      setStreak(streak);
      setWeeklyData(weekly);
    }

    if (seq !== loadSeqRef.current) return; // ✅ guard
    setLoading(false);
    console.log("Loading daily_summary for:", { selectedDate: date.toISOString(), selectedLocal, tz });

  };



  const handleMorningGateSubmit = async (score: number) => {
    console.log("Submitting overall score:", { userId, score });
    // Submit for the current date (after 5am, this is today; before 5am, user shouldn't see gate)
    const success = await submitDailyOverall(userId, score, new Date());
    console.log("Submit result:", success);
    if (success) {
      setIsLocked(false);
      setProgress((prev) => ({ ...prev, overallQuestion: true }));
      await loadDashboardData(userId, selectedDate, { forceWeekly: true });
    } else {
      console.error("Failed to submit overall score");
    }
  };

  const handleMealSubmit = async (
    mealType: string,
    description?: string,
    photoUrl?: string
  ) => {
    
    console.log("handleMealSubmit called", { mealType, description });
    const success = await logMeal(userId, mealType, description, photoUrl, selectedDate);
    console.log("logMeal returned:", success);
    if (success) {
      setProgress((prev) => ({ ...prev, mealLogged: true }));
      // Reload progress to reflect the new meal count
      await loadDashboardData(userId, selectedDate);
    }
  };

  const handleWaterSubmit = async (amountMl: number, source: string) => {
    console.log("handleWaterSubmit called", { amountMl, source });
    const success = await logWater(userId, amountMl, source, selectedDate);
    console.log("logWater returned:", success);
    if (success) {
      setProgress((prev) => ({ ...prev, waterLogged: true }));
      await loadDashboardData(userId, selectedDate, { forceWeekly: true });
    }
  };

  // ADD: journal callback so streak/checklist refresh immediately after journaling
  const handleJournalMessageSent = async () => {
    if (!userId) return;
    // reload from DB-backed daily_summary snapshot (fast: 1 RPC + 1 read)
    await loadDashboardData(userId, selectedDate, { forceWeekly: true });
  };

  const handleCheckInSubmit = async (data: {
    sleepQuality: number;
    energy: number;
    focus: number;
    workload: number;
    copingCapacity: number;
    stress: number;
    stressUnexpected: number;
    social: number;
    mood: number;
    moodStability: number;
    emotions: string[];
  }) => {
    console.log("handleCheckInSubmit called");
    const success = await submitDailyCheckIn(
      userId,
      data.sleepQuality,
      data.energy,
      data.focus,
      data.workload,
      data.copingCapacity,
      data.stress,
      data.stressUnexpected,
      data.social,
      data.mood,
      data.moodStability,
      data.emotions,
      selectedDate
    );
    console.log("submitDailyCheckIn returned:", success);
    if (success) {
      setProgress((prev) => ({ ...prev, checkInCompleted: true }));
      await loadDashboardData(userId, selectedDate, { forceWeekly: true });
    }
  };

  const completedTasks = Object.values(progress).filter(Boolean).length;
  const totalTasks = 5;

  if (loading) {
    return (
      <div className="min-h-screen bg-black dark:bg-black light:bg-gradient-to-br light:from-cyan-600 light:to-cyan-700 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div
      className="h-screen overflow-y-scroll scroll-snap-y scroll-snap-mandatory"
      onScroll={(e) => {
      const el = e.currentTarget;
      setShowScrollArrow(el.scrollTop < el.clientHeight * 0.5);
    }}
    >
      
      {/* ======================================================= */}
      {/* SCREEN 1 — ORIENTATION */}
      {/* ======================================================= */}
      <section 
        className="h-screen scroll-snap-start relative overflow-hidden"
        style={{
          background: 'var(--screen-bg-gradient)'
        }}
      >
        {/* Cyan gradient header area for light mode only */}
        <div className="absolute top-0 left-0 right-0 h-14 light:bg-gradient-to-r light:from-cyan-600 light:to-cyan-700 dark:hidden" />
        
        <DashboardBackground />

        <div className="relative z-10 h-full flex flex-col">
          {/* NAV */}
          <TopNav />

          {/* CONTENT */}
          <div className="flex-1 flex flex-col justify-between py-6 px-4 sm:px-6">
            {/* GREETING - top */}
            <div className="pt-4">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight dark:text-white light:text-cyan-700">
                Welcome Back, {firstName}.
              </h1>
            </div>

            {/* STREAK - center */}
            <div className="flex-1 flex flex-col items-center justify-center gap-4 sm:gap-6 py-4">
              <div className="scale-90 sm:scale-100 md:scale-110">
                <StreakRing
                  streak={streak}
                  tasksCompleted={completedTasks}
                  totalTasks={totalTasks}
                />
              </div>
              
              {/* WEEKLY STREAK - integrated */}
              <div className="w-full max-w-md px-4">
                <WeeklyStreak
                  weeklyData={weeklyData}
                  streak={streak}
                  timeZone={canonicalTz}
                />
              </div>
            </div>

            {/* BOTTOM SECTION - coach and tagline */}
            <div className="pb-4">
              {/* RYTM COACH MESSAGE */}
              <div className="text-center mb-3">
                <p className="text-xs sm:text-sm font-medium dark:text-zinc-500 light:text-slate-500 tracking-widest uppercase">
                  RYTM Coach
                </p>
              </div>

              {/* COACH PROMPT BAR */}
              <div className="flex justify-center">
                <CoachPromptBar 
                  onSendMessage={(message) => {
                    setInitialCoachMessage(message);
                    setShowCoachModal(true);
                  }}
                  onOpenChats={() => setShowCoachModal(true)}
                />
              </div>
              
              {/* START LOGGING - positioned below coach bar */}
              {showScrollArrow && (
                <div className="flex justify-center mt-4 sm:mt-6">
                  <button
                    onClick={() => {
                      const element = actionScreenRef.current;
                      if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }}
                    className="
                      flex flex-col items-center gap-1 sm:gap-2
                      dark:text-zinc-400 light:text-slate-600
                      dark:hover:text-white light:hover:text-purple-600
                      transition-all duration-300
                      group
                      cursor-pointer
                    "
                    aria-label="Start Logging"
                  >
                    <div className="text-xs sm:text-sm font-semibold tracking-wide uppercase opacity-80 group-hover:opacity-100">Start Logging</div>
                    <div className="text-2xl sm:text-3xl animate-bounce">↓</div>
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </section>

      {/* ======================================================= */}
      {/* SCREEN 2 — ACTION */}
      {/* ======================================================= */}
      <section 
        ref={actionScreenRef} 
        className="h-screen dark:bg-white light:bg-cyan-600 scroll-snap-start"
      >
        <div className="h-full px-4 sm:px-6 py-6 sm:py-8 flex gap-4 sm:gap-6 max-w-7xl mx-auto
                        flex-col lg:flex-row">
          {/* =================================================== */}
          {/* LEFT: CHECKLIST */}
          {/* =================================================== */}
          <div className="w-full lg:w-[360px] lg:flex-shrink-0 h-full dark:bg-black light:bg-white/95 dark:text-white light:text-slate-900 rounded-xl p-4 sm:p-6 light:border-none light:shadow-xl flex flex-col">
            <h2 className="font-semibold mb-4">Today's Checklist</h2>

            {/* KEEP: real ProgressList with routing/modals */}
            <div className="flex-1 overflow-y-auto">
              <ProgressList
              progress={progress}
              currentDate={selectedDate}
              onDateChange={setSelectedDate}
              onAction={(action) => {
                if (action === "overall") setShowOverallModal(true);
                if (action === "meal") setShowMealModal(true);
                if (action === "water") setShowWaterModal(true);
                if (action === "checkin") setShowCheckInModal(true);
                if (action === "journal") {
                  setJournalAutoFocus(true);
                  setTimeout(() => setJournalAutoFocus(false), 100);
                }
              }}
              />
            </div>
          </div>

          {/* =================================================== */}
          {/* RIGHT: JOURNAL */}
          {/* =================================================== */}
          <div className="w-full lg:flex-1 h-full dark:bg-black light:bg-white/95 dark:text-white light:text-slate-900 rounded-xl p-4 sm:p-6 light:border-none light:shadow-xl flex flex-col">
            <JournalChat autoFocus={journalAutoFocus} 
            onMessageSent={handleJournalMessageSent} // ADD
            selectedDate={selectedDate}
            canonicalTimeZone={canonicalTz}
          />
          </div>
          
        </div>
      </section>

      {/* ======================================================= */}
      {/* KEEP: NUDGE TOAST */}
      {/* ======================================================= */}
      <NudgeToast
        tasks={{
          overallQuestion: progress.overallQuestion,
          mealLogged: progress.mealLogged,
          waterLogged: progress.waterLogged,
          checkInCompleted: progress.checkInCompleted,
          journalCompleted: progress.journalCompleted,
        }}
        onAction={(action) => {
          if (action === "meal") setShowMealModal(true);
          if (action === "water") setShowWaterModal(true);
          if (action === "checkin") setShowCheckInModal(true);
          if (action === "journal") {
            setJournalAutoFocus(true);
            setTimeout(() => setJournalAutoFocus(false), 100);
          }
        }}
      />

      {/* ======================================================= */}
      {/* KEEP: MORNING GATE (disabled in DEV_MODE) */}
      {/* ======================================================= */}
      {isLocked && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <OverallSliderCard onSubmit={handleMorningGateSubmit} />
          </div>
        </>
      )}
      
      {/* ADD: Overall Mood modal from checklist (independent from isLocked) */}
      {showOverallModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <OverallSliderCard
              onSubmit={async (score: number) => {
                // IMPORTANT: use selectedDate for backlogging
                const ok = await submitDailyOverall(userId, score, selectedDate);
                if (ok) {
                  setShowOverallModal(false);
                  // reload to update checklist + weekly/streak if needed
                  await loadDashboardData(userId, selectedDate, { forceWeekly: true });
                }
              }}
            />
          </div>
        </>
      )}

      {/* ======================================================= */}
      {/* KEEP: MODALS */}
      {/* ======================================================= */}
      <LogMealModal
        isOpen={showMealModal}
        onClose={() => setShowMealModal(false)}
        onSubmit={handleMealSubmit}
        userId={userId}
      />
      <LogWaterModal
        isOpen={showWaterModal}
        onClose={() => setShowWaterModal(false)}
        onSubmit={handleWaterSubmit}
      />
      <DailyCheckInModal
        isOpen={showCheckInModal}
        onClose={() => setShowCheckInModal(false)}
        onSubmit={handleCheckInSubmit}
      />

      {/* ======================================================= */}
      {/* FULL-SCREEN COACH */}
      {/* ======================================================= */}
      <FullScreenCoach
        isOpen={showCoachModal}
        onClose={() => {
          setShowCoachModal(false);
          setInitialCoachMessage("");
        }}
        userId={userId}
        firstName={firstName}
        initialMessage={initialCoachMessage}
      />
    </div>
  );
}

