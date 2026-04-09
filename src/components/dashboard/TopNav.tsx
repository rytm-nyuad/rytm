"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react"; 
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  LayoutDashboard,
  Activity,
  Calendar,
  BarChart3,
  Trophy,
  LogOut,
  Menu,      
  X,
  Moon,
  Sun,
  Zap,
  ChevronRight,
  Plug,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { getCanonicalTimeZone, formatLocalTime } from "@/lib/time";

// CHANGE: DEV flag (temporary, for UI work)
const DEV_MODE = false;

// Fitbit connection status type
type FitbitStatus = "loading" | "connected" | "needs_reauth" | "not_connected";

// Add Calendar connection status type (same states as Fitbit)
type CalendarStatus = "loading" | "connected" | "needs_reauth" | "not_connected";

// WHOOP connection status type
type WhoopStatus = "loading" | "connected" | "needs_reauth" | "not_connected";

export function TopNav() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

 const [mobileOpen, setMobileOpen] = useState(false);
 const [fitbitStatus, setFitbitStatus] = useState<FitbitStatus>("loading");
 const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>("loading");
 const [whoopStatus, setWhoopStatus] = useState<WhoopStatus>("loading");
 const [integrationsOpen, setIntegrationsOpen] = useState(false);
 const [wearablesOpen, setWearablesOpen] = useState(false);
 const integrationsRef = useRef<HTMLDivElement>(null);
  const [userTimeZone, setUserTimeZone] = useState<string | null>(null);
  const [fitbitLastSynced, setFitbitLastSynced] = useState<Date | null>(null);
  const [fitbitSyncing, setFitbitSyncing] = useState(false);
  // CHANGE: only create Supabase client in non-DEV mode
  const supabase = DEV_MODE
  ? null
  : createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

  // Check Fitbit connection status on mount
  // Check Fitbit connection status on mount
  useEffect(() => {
    async function checkFitbitStatus() {
      if (!supabase) {
        setFitbitStatus("not_connected");
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          console.log("[TopNav] No user found, setting fitbit status to not_connected");
          setFitbitStatus("not_connected");
          setFitbitLastSynced(null);
          return;
        }

        console.log("[TopNav] Checking Fitbit status for user:", user.id);

        // 1) Get canonical timezone for this user (Fitbit > profile > browser)
        try {
          const tz = await getCanonicalTimeZone(supabase, user.id);
          setUserTimeZone(tz);
        } catch (tzErr) {
          console.error("[TopNav] Error getting canonical timezone:", tzErr);
          // fallback: leave userTimeZone as null; UI will just omit time label
        }

        // 2) ORIGINAL STATUS LOGIC (unchanged semantics)
        //    Only ask for "status" like before.
        const { data: creds, error } = await supabase
          .from("fitbit_credentials")
          .select("status")
          .eq("app_user_id", user.id)
          .maybeSingle();

        if (error) {
          console.error("[TopNav] Error fetching Fitbit credentials:", error);
          setFitbitStatus("not_connected");
          setFitbitLastSynced(null);
          return;
        }

        if (!creds) {
          console.log("[TopNav] No Fitbit credentials found, status: not_connected");
          setFitbitStatus("not_connected");
          setFitbitLastSynced(null);
          return;
        }

        console.log("[TopNav] Fitbit credentials status:", creds.status);

        if (creds.status === "needs_reauth") {
          setFitbitStatus("needs_reauth");
        } else {
          // If status is null/undefined, we still treat it as connected,
          // just like the old behavior once a row existed.
          setFitbitStatus("connected");
        }

        // 3) NEW: best-effort last_synced_at (does NOT affect status)
        //    If the column doesn't exist or query fails, we just skip it.
        const { data: syncRow, error: syncErr } = await supabase
          .from("fitbit_credentials")
          .select("last_synced_at")
          .eq("app_user_id", user.id)
          .maybeSingle();

        if (!syncErr && syncRow?.last_synced_at) {
          setFitbitLastSynced(new Date(syncRow.last_synced_at));
        } else {
          setFitbitLastSynced(null);
        }
      } catch (err) {
        console.error("[TopNav] Error checking Fitbit status:", err);
        setFitbitStatus("not_connected");
        setFitbitLastSynced(null);
      }
    }

    checkFitbitStatus();
  }, [supabase]);



  // Check Calendar connection status on mount (mirrors Fitbit logic)
  useEffect(() => {
    async function checkCalendarStatus() {
      if (!supabase) {
        setCalendarStatus("not_connected");
        return;
      }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setCalendarStatus("not_connected");
          return;
        }

        const { data: creds, error } = await supabase
          .from("calendar_credentials")
          .select("status")
          .eq("app_user_id", user.id)
          .maybeSingle();

        if (error || !creds) {
          setCalendarStatus("not_connected");
          return;
        }

        if (creds.status === "needs_reauth") setCalendarStatus("needs_reauth");
        else setCalendarStatus("connected");
      } catch (err) {
        console.error("[TopNav] Error checking Calendar status:", err);
        setCalendarStatus("not_connected");
      }
    }

    checkCalendarStatus();
  }, [supabase]);

  // Check WHOOP connection status on mount (mirrors Fitbit logic)
  useEffect(() => {
    async function checkWhoopStatus() {
      if (!supabase) {
        setWhoopStatus("not_connected");
        return;
      }

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setWhoopStatus("not_connected");
          return;
        }

        const { data: creds, error } = await supabase
          .from("whoop_credentials")
          .select("status")
          .eq("app_user_id", user.id)
          .maybeSingle();

        if (error || !creds) {
          setWhoopStatus("not_connected");
          return;
        }

        if (creds.status === "needs_reauth") setWhoopStatus("needs_reauth");
        else setWhoopStatus("connected");
      } catch (err) {
        console.error("[TopNav] Error checking WHOOP status:", err);
        setWhoopStatus("not_connected");
      }
    }

    checkWhoopStatus();
  }, [supabase]);

  const navItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/coach", icon: Zap, label: "Coach" },
    // { href: "/calendar", icon: Calendar, label: "Calendar" },
    // { href: "/exercise", icon: Dumbbell, label: "Exercise" },
    { href: "/analytics", icon: BarChart3, label: "Analytics" },
    { href: "/leaderboard", icon: Trophy, label: "Leaderboard" },
    // { href: "/settings", icon: Settings, label: "Settings" },
  ];

  const handleSignOut = async () => {
    if (!supabase) return;

    try {
      await supabase.auth.signOut();
      // Use window.location for full page navigation to clear all client state
      window.location.href = "/sign-in";
    } catch (error) {
      console.error("Sign out error:", error);
      // Still redirect even if there's an error
      window.location.href = "/sign-in";
    }
  };

  const handleConnectFitbit = () => {
    // Start the Fitbit OAuth flow:
    // This hits /api/fitbit/connect, which redirects to Fitbit
    window.location.href = "/api/fitbit/connect";
  };

  const handleConnectCalendar = () => {
    // Start the Calendar OAuth flow (server route will redirect to provider)
    window.location.href = "/api/calendar/connect";
  };

  const handleConnectWhoop = () => {
    // Start the WHOOP OAuth flow
    window.location.href = "/api/whoop/connect";
  };

  const triggerFitbitResync = async () => {
    if (fitbitStatus !== "connected") return;
    setFitbitSyncing(true);

    try {
      const res = await fetch("/api/fitbit/sync", { method: "POST" });

      if (!res.ok) {
        console.error("[TopNav] Fitbit sync failed with status:", res.status);
        // We could show a toast here later
        return;
      }

      // Expecting JSON like { ok: true, lastSynced: "2026-02-11T18:25:00.123Z" }
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // no body or not JSON, ignore
      }

      if (json?.lastSynced) {
        setFitbitLastSynced(new Date(json.lastSynced));
      } else {
        // Fallback: assume "now" if backend doesn't send lastSynced
        setFitbitLastSynced(new Date());
      }
    } catch (err) {
      console.error("[TopNav] Error calling /api/fitbit/sync:", err);
    } finally {
      setFitbitSyncing(false);
    }
  };

  // Compute wearables status: green if at least one is green, red if both are red
  const getWearablesStatus = () => {
    const fitbitGreen = fitbitStatus === "connected";
    const whoopGreen = whoopStatus === "connected";
    const fitbitRed = fitbitStatus === "needs_reauth" || fitbitStatus === "not_connected";
    const whoopRed = whoopStatus === "needs_reauth" || whoopStatus === "not_connected";

    if (fitbitGreen || whoopGreen) return "connected";
    if (fitbitRed && whoopRed) return "needs_reauth";
    return "loading";
  };

  // Compute integrations status: green if all are green, red if any is red
  const getIntegrationsStatus = () => {
    const wearablesStatus = getWearablesStatus();
    const calendarGreen = calendarStatus === "connected";
    const wearablesGreen = wearablesStatus === "connected";
    const calendarRed = calendarStatus === "needs_reauth" || calendarStatus === "not_connected";
    const wearablesRed = wearablesStatus === "needs_reauth";

    if (calendarGreen && wearablesGreen) return "connected";
    if (calendarRed || wearablesRed) return "needs_reauth";
    return "loading";
  };

  const wearablesStatus = getWearablesStatus();
  const integrationsStatus = getIntegrationsStatus();

  // Close integrations dropdown when clicking outside
  // Close integrations dropdown when clicking outside (DESKTOP ONLY)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (integrationsRef.current && !integrationsRef.current.contains(event.target as Node)) {
        setIntegrationsOpen(false);
        setWearablesOpen(false);
      }
    }

    // IMPORTANT: don't run this when mobile menu is open
    if (integrationsOpen && !mobileOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [integrationsOpen, mobileOpen]);

  return (
    <nav className="relative h-14 dark:bg-zinc-950 light:bg-gradient-to-r light:from-cyan-600 light:to-cyan-700 dark:border-b dark:border-zinc-800 light:border-none flex items-center px-4 sm:px-6 dark:shadow-none light:shadow-none">
      {/* ================================================= */}
      {/* LEFT: Brand */}
      {/* ================================================= */}
      <div className="dark:text-white light:text-white font-bold text-lg tracking-wide z-10">
        RYTM
      </div>

      {/* ================================================= */}
      {/* DESKTOP NAV (hidden on mobile) */}
      {/* ================================================= */}
      <div className="ml-auto hidden md:flex items-center gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "dark:bg-white dark:text-black light:bg-white light:text-blue-600"
                  : "dark:text-zinc-400 light:text-white/90 dark:hover:text-white light:hover:text-white dark:hover:bg-zinc-900 light:hover:bg-blue-500"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* Integrations dropdown (desktop) */}
        <div className="relative" ref={integrationsRef}>
          <button
            onClick={() => setIntegrationsOpen(!integrationsOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              integrationsStatus === "connected"
                ? "text-emerald-500 dark:text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                : integrationsStatus === "needs_reauth"
                ? "text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                : "text-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
            }`}
            title={
              integrationsStatus === "connected"
                ? "All integrations connected"
                : integrationsStatus === "needs_reauth"
                ? "Some integrations need attention"
                : "Checking integrations..."
            }
          >
            <Plug className="w-4 h-4" />
            <span>Integrations</span>
            {/* Status indicator dot */}
            <span
              className={`w-2 h-2 rounded-full ${
                integrationsStatus === "connected"
                  ? "bg-emerald-500"
                  : integrationsStatus === "needs_reauth"
                  ? "bg-red-500 animate-pulse"
                  : "bg-zinc-500"
              }`}
            />
          </button>

          {/* Integrations dropdown menu */}
          {integrationsOpen && (
            <div className="absolute top-full mt-1 right-0 w-56 dark:bg-zinc-900 light:bg-white rounded-lg shadow-lg border dark:border-zinc-800 light:border-gray-200 py-1 z-50">
              {/* Calendar */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIntegrationsOpen(false);
                  handleConnectCalendar();
                }}
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all ${
                  calendarStatus === "connected"
                    ? "text-emerald-500 dark:text-emerald-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                    : calendarStatus === "needs_reauth" || calendarStatus === "not_connected"
                    ? "text-red-500 dark:text-red-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                    : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-800 light:hover:bg-gray-100"
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span className="flex-1 text-left">
                  {calendarStatus === "connected" ? "Calendar ✓" : "Calendar"}
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    calendarStatus === "connected"
                      ? "bg-emerald-500"
                      : calendarStatus === "needs_reauth" || calendarStatus === "not_connected"
                      ? "bg-red-500 animate-pulse"
                      : "bg-zinc-500"
                  }`}
                />
              </button>

              {/* Wearables (expandable) */}
              <div className="relative">
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setWearablesOpen(!wearablesOpen);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all ${
                    wearablesStatus === "connected"
                      ? "text-emerald-500 dark:text-emerald-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                      : wearablesStatus === "needs_reauth"
                      ? "text-red-500 dark:text-red-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                      : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-800 light:hover:bg-gray-100"
                  }`}
                >
                  <Activity className="w-4 h-4" />
                  <span className="flex-1 text-left">Wearables</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      wearablesStatus === "connected"
                        ? "bg-emerald-500"
                        : wearablesStatus === "needs_reauth"
                        ? "bg-red-500 animate-pulse"
                        : "bg-zinc-500"
                    }`}
                  />
                  <ChevronRight
                    className={`w-4 h-4 transition-transform ${
                      wearablesOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {/* Wearables submenu */}
                {wearablesOpen && (
                <div className="pl-4 py-1 space-y-1">
                  {/* Fitbit connection (ALWAYS goes to OAuth) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIntegrationsOpen(false);
                      setWearablesOpen(false);
                      handleConnectFitbit();
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all ${
                      fitbitStatus === "connected"
                        ? "text-emerald-500 dark:text-emerald-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                        : fitbitStatus === "needs_reauth" || fitbitStatus === "not_connected"
                        ? "text-red-500 dark:text-red-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                        : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-800 light:hover:bg-gray-100"
                    }`}
                  >
                    <Activity className="w-4 h-4" />
                    <span className="flex-1 text-left">
                      {fitbitStatus === "connected"
                        ? "Fitbit (connected)"
                        : "Connect / Reconnect Fitbit"}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        fitbitStatus === "connected"
                          ? "bg-emerald-500"
                          : fitbitStatus === "needs_reauth" || fitbitStatus === "not_connected"
                          ? "bg-red-500 animate-pulse"
                          : "bg-zinc-500"
                      }`}
                    />
                  </button>

                  {/* NEW: Fitbit Re-sync data (only enabled when connected) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fitbitStatus !== "connected") return;
                      setIntegrationsOpen(false);
                      setWearablesOpen(false);
                      triggerFitbitResync();
                    }}
                    disabled={fitbitStatus !== "connected"}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm rounded-md transition-all ${
                      fitbitStatus === "connected"
                        ? "text-zinc-300 dark:text-zinc-200 hover:bg-zinc-800 light:hover:bg-gray-100 cursor-pointer"
                        : "text-zinc-500 dark:text-zinc-600 cursor-not-allowed opacity-60"
                    }`}
                  >
                    <Activity className="w-4 h-4" />
                    <span className="flex-1 text-left">
                      {fitbitSyncing
                        ? "Syncing…"
                        : fitbitStatus !== "connected"
                        ? "Re-sync (connect first)"
                        : fitbitLastSynced && userTimeZone
                        ? `Re-sync Fitbit data • Last: ${formatLocalTime(
                            fitbitLastSynced,
                            userTimeZone
                          )}`
                        : "Re-sync Fitbit data"}
                    </span>

                  </button>

                  {/* WHOOP (unchanged) */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIntegrationsOpen(false);
                      setWearablesOpen(false);
                      handleConnectWhoop();
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all ${
                      whoopStatus === "connected"
                        ? "text-emerald-500 dark:text-emerald-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                        : whoopStatus === "needs_reauth" || whoopStatus === "not_connected"
                        ? "text-red-500 dark:text-red-400 hover:bg-zinc-800 light:hover:bg-gray-100"
                        : "text-zinc-400 dark:text-zinc-500 hover:bg-zinc-800 light:hover:bg-gray-100"
                    }`}
                  >
                    <Zap className="w-4 h-4" />
                    <span className="flex-1 text-left">
                      {whoopStatus === "connected" ? "WHOOP ✓" : "WHOOP"}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        whoopStatus === "connected"
                          ? "bg-emerald-500"
                          : whoopStatus === "needs_reauth" || whoopStatus === "not_connected"
                          ? "bg-red-500 animate-pulse"
                          : "bg-zinc-500"
                      }`}
                    />
                  </button>
                </div>
              )}

              </div>
            </div>
          )}
        </div>

        {/* Theme toggle button */}
        <button
          onClick={toggleTheme}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium dark:text-zinc-400 light:text-white/90 dark:hover:text-white light:hover:text-white dark:hover:bg-zinc-900 light:hover:bg-blue-500 transition-all ml-2"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        

        {/* KEEP: Sign out (desktop) */}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-red-500 dark:hover:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>

      {/* ================================================= */}
      {/* MOBILE MENU BUTTON */}
      {/* ================================================= */}
      <button
        onClick={() => setMobileOpen((v) => !v)}
        className="ml-auto md:hidden dark:text-zinc-400 light:text-white/80 dark:hover:text-white light:hover:text-white transition"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* ================================================= */}
      {/* MOBILE DROPDOWN */}
      {/* ================================================= */}
      {mobileOpen && (
        <div className="absolute top-14 left-0 w-full dark:bg-zinc-950 light:bg-cyan-600 dark:border-t dark:border-zinc-800 md:hidden z-50">
          <div className="flex flex-col px-4 py-3 gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)} // ADD
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-white text-black dark:text-black light:text-cyan-600"
                      : "text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-white dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
            
            {/* MOBILE INTEGRATIONS SECTION */}
            <div className="border-t dark:border-zinc-800 light:border-cyan-500 pt-2 mt-2">
              {/* Integrations header */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIntegrationsOpen(!integrationsOpen);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                  integrationsStatus === "connected"
                    ? "text-emerald-500 dark:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                    : integrationsStatus === "needs_reauth"
                    ? "text-red-500 dark:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                    : "text-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                }`}
              >
                <Plug className="w-4 h-4" />
                <span className="flex-1 text-left">Integrations</span>
                <span
                  className={`w-2 h-2 rounded-full ${
                    integrationsStatus === "connected"
                      ? "bg-emerald-500"
                      : integrationsStatus === "needs_reauth"
                      ? "bg-red-500 animate-pulse"
                      : "bg-zinc-500"
                  }`}
                />
                <ChevronRight
                  className={`w-4 h-4 transition-transform ${
                    integrationsOpen ? "rotate-90" : ""
                  }`}
                />
              </button>

              {/* Integrations dropdown content */}
              {integrationsOpen && (
                <div className="pl-4 mt-1">
                  {/* Calendar */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMobileOpen(false);
                      setIntegrationsOpen(false);
                      handleConnectCalendar();
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                      calendarStatus === "connected"
                        ? "text-emerald-500 dark:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                        : calendarStatus === "needs_reauth" || calendarStatus === "not_connected"
                        ? "text-red-500 dark:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                        : "text-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                    }`}
                  >
                    <Calendar className="w-4 h-4" />
                    <span className="flex-1 text-left">
                      {calendarStatus === "connected" ? "Calendar ✓" : "Calendar"}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        calendarStatus === "connected"
                          ? "bg-emerald-500"
                          : calendarStatus === "needs_reauth" || calendarStatus === "not_connected"
                          ? "bg-red-500 animate-pulse"
                          : "bg-zinc-500"
                      }`}
                    />
                  </button>

                  {/* Wearables */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setWearablesOpen(!wearablesOpen);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                      wearablesStatus === "connected"
                        ? "text-emerald-500 dark:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                        : wearablesStatus === "needs_reauth"
                        ? "text-red-500 dark:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                        : "text-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                    }`}
                  >
                    <Activity className="w-4 h-4" />
                    <span className="flex-1 text-left">Wearables</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        wearablesStatus === "connected"
                          ? "bg-emerald-500"
                          : wearablesStatus === "needs_reauth"
                          ? "bg-red-500 animate-pulse"
                          : "bg-zinc-500"
                      }`}
                    />
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${
                        wearablesOpen ? "rotate-90" : ""
                      }`}
                    />
                  </button>

                  {/* Wearables submenu */}
                  {wearablesOpen && (
                  <div className="pl-4 mt-1 space-y-1">
                    {/* Fitbit connection (ALWAYS OAuth) */}
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMobileOpen(false);
                        setIntegrationsOpen(false);
                        setWearablesOpen(false);
                        handleConnectFitbit();
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                        fitbitStatus === "connected"
                          ? "text-emerald-500 dark:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                          : fitbitStatus === "needs_reauth" || fitbitStatus === "not_connected"
                          ? "text-red-500 dark:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                          : "text-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                      }`}
                    >
                      <Activity className="w-4 h-4" />
                      <span className="flex-1 text-left">
                        {fitbitStatus === "connected" ? "Fitbit (connected)" : "Connect / Reconnect Fitbit"}
                      </span>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          fitbitStatus === "connected"
                            ? "bg-emerald-500"
                            : fitbitStatus === "needs_reauth" || fitbitStatus === "not_connected"
                            ? "bg-red-500 animate-pulse"
                            : "bg-zinc-500"
                        }`}
                      />
                    </button>

                    {/* NEW: Re-sync Fitbit data */}
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (fitbitStatus !== "connected") return;
                        setMobileOpen(false);
                        setIntegrationsOpen(false);
                        setWearablesOpen(false);
                        triggerFitbitResync();
                      }}
                      disabled={fitbitStatus !== "connected"}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                        fitbitStatus === "connected"
                          ? "text-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 cursor-pointer"
                          : "text-zinc-500 dark:text-zinc-600 cursor-not-allowed opacity-60"
                      }`}
                    >
                      <Activity className="w-4 h-4" />
                      <span className="flex-1 text-left">
                      {fitbitSyncing
                        ? "Syncing…"
                        : fitbitStatus !== "connected"
                        ? "Re-sync (connect first)"
                        : fitbitLastSynced && userTimeZone
                        ? `Re-sync Fitbit • Last: ${formatLocalTime(
                            fitbitLastSynced,
                            userTimeZone
                          )}`
                        : "Re-sync Fitbit data"}
                    </span>

                    </button>


                      {/* WHOOP */}
                      <button
                        onMouseDown={e => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMobileOpen(false);
                          setIntegrationsOpen(false);
                          setWearablesOpen(false);
                          handleConnectWhoop();
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${
                          whoopStatus === "connected"
                            ? "text-emerald-500 dark:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                            : whoopStatus === "needs_reauth" || whoopStatus === "not_connected"
                            ? "text-red-500 dark:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                            : "text-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-900 light:hover:bg-cyan-500"
                        }`}
                      >
                        <Zap className="w-4 h-4" />
                        <span className="flex-1 text-left">
                          {whoopStatus === "connected" ? "WHOOP ✓" : "WHOOP"}
                        </span>
                        <span
                          className={`w-2 h-2 rounded-full ${
                            whoopStatus === "connected"
                              ? "bg-emerald-500"
                              : whoopStatus === "needs_reauth" || whoopStatus === "not_connected"
                              ? "bg-red-500 animate-pulse"
                              : "bg-zinc-500"
                          }`}
                        />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* MOBILE THEME TOGGLE */}
            <button
              onClick={toggleTheme}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-white dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
            </button>

            {/* MOBILE SIGN OUT */}
            <button
              onClick={handleSignOut}
              className="mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-red-500 dark:hover:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}