"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createBrowserClient } from "@supabase/ssr";

import { OverallSliderCard } from "@/components/dashboard/OverallSliderCard";
import { StreakRing } from "@/components/dashboard/StreakRing";
import { ProgressList } from "@/components/dashboard/ProgressList";
import { LogMealModal } from "@/components/dashboard/LogMealModal";
import { LogWaterModal } from "@/components/dashboard/LogWaterModal";
import { DailyCheckInModal } from "@/components/dashboard/DailyCheckInModal";
import { JournalChat } from "@/components/dashboard/JournalChat";
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
} from "@/lib/db/dashboard";

import type { TodayProgress } from "@/types/dashboard";
const CoachChat = dynamic(
  () =>
    import("@/components/dashboard/CoachChat").then(
      (mod) => mod.CoachChat
    ),
  { ssr: false }
);

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
    <div
      className="h-screen overflow-y-scroll scroll-snap-y scroll-snap-mandatory"
      onScroll={(e) => {
      const el = e.currentTarget;
      setShowScrollArrow(el.scrollTop < el.clientHeight * 0.5);
    }}
    >
      
      {/* ======================================================= */}
      {/* SCREEN 1 — ORIENTATION (BLACK) */}
      {/* ======================================================= */}
      <section className="h-screen bg-black text-white scroll-snap-start">
        <DashboardBackground />

        <div className="relative z-10 h-full flex flex-col">
          {/* NAV */}
          <TopNav />

          {/* CONTENT */}
          <div
            className="
              flex-1
              grid
              grid-rows-[auto_1fr_auto]
              px-4 sm:px-6
              pt-6 sm:pt-10
            "
          >
            {/* GREETING */}
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight">
              Welcome Back, {firstName}.
            </h1>

            {/* STREAK */}
            <div className="flex items-center justify-center">
              <div className="scale-[0.9] sm:scale-[1.15] md:scale-[1.4]">
                <StreakRing
                  streak={streak}
                  tasksCompleted={completedTasks}
                  totalTasks={totalTasks}
                />
              </div>
            </div>

            {/* FOCUS */}
            <div className="text-center text-sm sm:text-lg text-zinc-400 max-w-md mx-auto">
              <TodaysFocus />
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
              text-zinc-400
              hover:text-white
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
      {/* SCREEN 2 — ACTION (WHITE) */}
      {/* ======================================================= */}
      <section className="h-screen bg-white scroll-snap-start">
        <div className="h-full px-6 py-8 flex gap-6 max-w-7xl mx-auto
                        flex-col md:flex-row">
          {/* =================================================== */}
          {/* LEFT: CHECKLIST */}
          {/* =================================================== */}
          <div className="md:w-[360px] bg-black text-white rounded-xl p-6">
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
          {/* RIGHT: COACH */}
          {/* =================================================== */}
          <div className="flex-1 bg-black text-white rounded-xl p-6">
            <CoachChat />
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
    </div>
  );
}

