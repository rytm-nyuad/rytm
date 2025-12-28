"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { OverallSliderCard } from "@/components/dashboard/OverallSliderCard";
import { StreakRing } from "@/components/dashboard/StreakRing";
import { ProgressList } from "@/components/dashboard/ProgressList";
import { LogMealModal } from "@/components/dashboard/LogMealModal";
import { LogWaterModal } from "@/components/dashboard/LogWaterModal";
import { DailyCheckInModal } from "@/components/dashboard/DailyCheckInModal";
import { JournalChat } from "@/components/dashboard/JournalChat";
import { CoachChat } from "@/components/dashboard/CoachChat";
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
} from "@/lib/db/dashboard";
import type { TodayProgress } from "@/types/dashboard";

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("there");
  const [streak, setStreak] = useState(0);
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

  const router = useRouter();
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

    setProgress({
      overallQuestion: !!todayOverall,
      mealLogged: mealsCount > 0,
      waterLogged,
      checkInCompleted: checkInDone,
      journalCompleted: false, // Will be updated when user sends first message
    });

    // Load streak data
    const streakCount = await import("@/lib/db/dashboard").then((m) =>
      m.getStreakData(userId)
    );
    setStreak(streakCount);

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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">
      {/* Background - z-0 */}
      <DashboardBackground />

      {/* Top Navigation - z-10 */}
      <div className="relative z-10">
        <TopNav />
      </div>

      {/* Nudge Toast - z-50 with safe top offset */}
      <NudgeToast 
        tasks={{
          overallQuestion: progress.overallQuestion,
          mealLogged: progress.mealLogged,
          waterLogged: progress.waterLogged,
          checkInCompleted: progress.checkInCompleted,
          journalCompleted: progress.journalCompleted,
        }}
        onAction={(action) => {
          if (action === 'meal') setShowMealModal(true);
          if (action === 'water') setShowWaterModal(true);
          if (action === 'checkin') setShowCheckInModal(true);
          if (action === 'journal') {
            // Scroll to journal and focus input
            const journalInput = document.querySelector('#journal-input') as HTMLInputElement;
            journalInput?.focus();
            journalInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }}
      />

      {/* Lock Overlay + Slider Card (when locked) - z-40/z-50 */}
      {isLocked && (
        <>
          {/* Overlay - z-40 */}
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" />
          
          {/* Overall Slider Card (centered, above blur) - z-50 */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <OverallSliderCard onSubmit={handleMorningGateSubmit} />
          </div>
        </>
      )}

      {/* Main Content Container - Normal document flow */}
      <main
        className={`relative flex-1 flex flex-col overflow-hidden transition-all duration-300 ${
          isLocked ? "blur-lg opacity-35 pointer-events-none" : ""
        }`}
      >
        {/* Section 1: Header - z-10 */}
        <header className="relative z-10 px-6 pt-5 pb-4">
          <h1 className="text-3xl font-bold mb-0.5 tracking-tight">
            Welcome back, {firstName}.
          </h1>
          <p className="text-zinc-500 text-sm mb-2">Let's track your day.</p>
          <TodaysFocus />
        </header>

        {/* Content Sections Container - Strict vertical layout */}
        <div className="relative flex-1 px-6 pb-6 flex flex-col gap-y-4 overflow-hidden">
          {/* Section 2: Metrics Row - Fixed height, no overlap */}
          <section className="grid grid-cols-2 gap-3 h-[260px] flex-shrink-0">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-8 flex items-center justify-center overflow-hidden">
              <StreakRing 
                streak={streak} 
                tasksCompleted={completedTasks}
                totalTasks={totalTasks}
              />
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-xl p-8 overflow-hidden">
              <ProgressList 
                progress={progress}
                onAction={(action) => {
                  if (action === 'meal') setShowMealModal(true);
                  if (action === 'water') setShowWaterModal(true);
                  if (action === 'checkin') setShowCheckInModal(true);
                  if (action === 'journal') {
                    const journalInput = document.querySelector('#journal-input') as HTMLInputElement;
                    journalInput?.focus();
                    journalInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
              />
            </div>
          </section>

          {/* Section 3: Quick Actions Row - Fixed height, no overlap */}
          <section className="flex gap-3 h-[56px] flex-shrink-0">
            <button
              onClick={() => setShowMealModal(true)}
              className="flex-1 bg-white text-black font-semibold rounded-xl hover:bg-zinc-100 transition-all duration-200 hover:shadow-lg text-sm"
            >
              Log Meal
            </button>
            <button
              onClick={() => setShowWaterModal(true)}
              className="flex-1 bg-transparent border border-zinc-700 text-white font-semibold rounded-xl hover:border-zinc-600 hover:bg-zinc-900 transition-all duration-200 hover:shadow-md text-sm"
            >
              Log Water
            </button>
            <button
              onClick={() => setShowCheckInModal(true)}
              className="flex-1 bg-transparent border border-zinc-700 text-white font-semibold rounded-xl hover:border-zinc-600 hover:bg-zinc-900 transition-all duration-200 hover:shadow-md text-sm"
            >
              Daily Check-in
            </button>
          </section>

          {/* Section 4: Content Row (Journal + Coach) - Constrained height */}
          <section className="grid grid-cols-2 gap-3 flex-1 min-h-0 max-h-[400px]">
            <div className="overflow-hidden">
              <JournalChat
                onMessageSent={() =>
                  setProgress((prev) => ({ ...prev, journalCompleted: true }))
                }
              />
            </div>
            <div className="overflow-hidden">
              <CoachChat />
            </div>
          </section>
        </div>
      </main>

      {/* Modals - z-100 */}
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
    </div>
  );
}

