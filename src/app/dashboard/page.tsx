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
  const [streak, setStreak] = useState(0);
  const [weeklyData, setWeeklyData] = useState<boolean[]>([false, false, false, false, false, false, false]);
  const [progress, setProgress] = useState<TodayProgress>({
    overallQuestion: false,
    mealLogged: false,
    waterLogged: false,
    checkInCompleted: false,
    journalCompleted: false,
  });

  // Modal states
  const [showMealModal, setShowMealModal] = useState(false);
  const [showWaterModal, setShowWaterModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showCoachModal, setShowCoachModal] = useState(false);
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

  const checkAuth = async () => {

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push("/sign-in");
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

    await loadDashboardData(session.user.id);
  };

  const loadDashboardData = async (userId: string) => {
    // Check if morning gate needed
    const todayOverall = await getTodayOverall(userId);
    setIsLocked(!todayOverall);

    // Load progress data
    const mealsCount = await getTodayMealsCount(userId);
    const waterLogged = await hasWaterLoggedToday(userId);
    const checkInDone = await hasCheckInToday(userId);
    const journalDone = await import("@/lib/db/journal-check").then((m) =>
      m.hasJournaledToday(userId)
    );

    setProgress({
      overallQuestion: !!todayOverall,
      mealLogged: mealsCount > 0,
      waterLogged,
      checkInCompleted: checkInDone,
      journalCompleted: journalDone,
    });

    // Load streak data
    const streakCount = await import("@/lib/db/dashboard").then((m) =>
      m.getStreakData(userId)
    );
    setStreak(streakCount);

    // Load weekly activity data
    const weekly = await getWeeklyActivity(userId);
    setWeeklyData(weekly);

    setLoading(false);
  };


  const handleMorningGateSubmit = async (score: number) => {
    console.log("Submitting overall score:", { userId, score });
    const success = await submitDailyOverall(userId, score);
    console.log("Submit result:", success);
    if (success) {
      setIsLocked(false);
      setProgress((prev) => ({ ...prev, overallQuestion: true }));
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
    const success = await logMeal(userId, mealType, description, photoUrl);
    console.log("logMeal returned:", success);
    if (success) {
      setProgress((prev) => ({ ...prev, mealLogged: true }));
      // Reload progress to reflect the new meal count
      await loadDashboardData(userId);
    }
  };

  const handleWaterSubmit = async (amountMl: number, source: string) => {
    console.log("handleWaterSubmit called", { amountMl, source });
    const success = await logWater(userId, amountMl, source);
    console.log("logWater returned:", success);
    if (success) {
      setProgress((prev) => ({ ...prev, waterLogged: true }));
      await loadDashboardData(userId);
    }
  };

  const handleCheckInSubmit = async (
    mood: number,
    stress: number,
    energy: number,
    focus: number,
    workload: number,
    sleepRestfulness: number,
    socialConnectedness: number,
    emotions: string[]
  ) => {
    console.log("handleCheckInSubmit called");
    const success = await submitDailyCheckIn(
      userId,
      mood,
      stress,
      energy,
      focus,
      workload,
      sleepRestfulness,
      socialConnectedness,
      emotions
    );
    console.log("submitDailyCheckIn returned:", success);
    if (success) {
      setProgress((prev) => ({ ...prev, checkInCompleted: true }));
      await loadDashboardData(userId);
    }
  };

  const completedTasks = Object.values(progress).filter(Boolean).length;
  const totalTasks = 5;

  if (loading) {
    return (
      <div className="min-h-screen bg-black dark:bg-black light:bg-cyan-500 flex items-center justify-center">
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
      <section className="h-screen dark:bg-gradient-to-b dark:from-black dark:via-zinc-950 dark:to-black light:bg-gradient-to-b light:from-cyan-500 light:via-cyan-500 light:to-cyan-600 text-white scroll-snap-start relative overflow-hidden">
        <DashboardBackground />

        <div className="relative z-10 h-full flex flex-col">
          {/* NAV */}
          <TopNav />

          {/* CONTENT */}
          <div className="flex-1 flex flex-col justify-center px-4 sm:px-6">
            {/* GREETING - top */}
            <div className="absolute top-16 left-4 sm:left-6">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                Welcome Back, {firstName}.
              </h1>
            </div>

            {/* STREAK - dead center, slightly up */}
            <div className="flex justify-center -mt-20">
              <div className="scale-[1.0] sm:scale-[1.1] md:scale-[1.3]">
                <StreakRing
                  streak={streak}
                  tasksCompleted={completedTasks}
                  totalTasks={totalTasks}
                />
              </div>
            </div>

            {/* WEEKLY STREAK - separate below */}
            <div className="mt-8">
              <WeeklyStreak weeklyData={weeklyData} streak={streak} />
            </div>

            {/* BOTTOM SECTION - coach and tagline */}
            <div className="absolute bottom-16 left-0 right-0 px-4 sm:px-6">
              {/* ELITE COACH MESSAGE */}
              <div className="text-center mb-3">
                <p className="text-xs font-medium dark:text-zinc-500 light:text-cyan-200/80 tracking-widest uppercase">
                  Your Elite Coach
                </p>
              </div>

              {/* COACH PROMPT BAR */}
              <div className="flex justify-center mb-6">
                <CoachPromptBar 
                  onSendMessage={(message) => {
                    setInitialCoachMessage(message);
                    setShowCoachModal(true);
                  }} 
                />
              </div>

              {/* FOCUS - at bottom */}
              <div className="text-center text-xs dark:text-zinc-600 light:text-cyan-200/60">
                <TodaysFocus />
              </div>
            </div>
          </div>

          {showScrollArrow && (
          <button
            onClick={() =>
              actionScreenRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="
              absolute
              bottom-6
              left-1/2
              -translate-x-1/2
              dark:text-zinc-400 light:text-cyan-200
              dark:hover:text-white light:hover:text-white
              transition
            "
            aria-label="Scroll down"
          >
            <div className="text-3xl animate-bounce">↓</div>
          </button>
        )}

        </div>
      </section>

      {/* ======================================================= */}
      {/* SCREEN 2 — ACTION */}
      {/* ======================================================= */}
      <section className="h-screen dark:bg-white light:bg-cyan-500 scroll-snap-start">
        <div className="h-full px-6 py-8 flex gap-6 max-w-7xl mx-auto
                        flex-col md:flex-row">
          {/* =================================================== */}
          {/* LEFT: CHECKLIST */}
          {/* =================================================== */}
          <div className="md:w-[360px] dark:bg-black light:bg-cyan-600 dark:text-white light:text-white rounded-xl p-6">
            <h2 className="font-semibold mb-4">Today’s Checklist</h2>

            {/* KEEP: real ProgressList with routing/modals */}
            <ProgressList
              progress={progress}
              onAction={(action) => {
                if (action === "meal") setShowMealModal(true);
                if (action === "water") setShowWaterModal(true);
                if (action === "checkin") setShowCheckInModal(true);
                if (action === "journal") {
                  //to do
                }
              }}
            />
          </div>

          {/* =================================================== */}
          {/* RIGHT: JOURNAL */}
          {/* =================================================== */}
          <div className="flex-1 dark:bg-black light:bg-cyan-600 dark:text-white light:text-white rounded-xl p-6">
            <JournalChat />
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
                  //to do
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

