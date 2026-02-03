"use client";

import Link from "next/link";
import { useState } from "react"; 
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  LayoutDashboard,
  Activity,
  Calendar,
  Dumbbell,
  BarChart3,
  Trophy,
  Settings,
  LogOut,
  Menu,      
  X,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

// CHANGE: DEV flag (temporary, for UI work)
const DEV_MODE = false;

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

 const [mobileOpen, setMobileOpen] = useState(false);

// CHANGE: only create Supabase client in non-DEV mode
  const supabase = DEV_MODE
  ? null
  : createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

  const navItems = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
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

        {/* Connect Fitbit button (desktop) */}
        <button
          onClick={handleConnectFitbit}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition-all"
          title="Connect Fitbit"
        >
          <Activity className="w-4 h-4" />
          <span>Fitbit</span>
        </button>

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
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition-all"
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
            {/* MOBILE CONNECT FITBIT */}
            <button
              onClick={() => {
                setMobileOpen(false);
                handleConnectFitbit();
              }}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-emerald-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition"
            >
              <Activity className="w-4 h-4" />
              <span>Connect Fitbit</span>
            </button>

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
              className="mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 dark:text-zinc-400 light:text-cyan-100 hover:text-red-400 dark:hover:bg-zinc-900 light:hover:bg-cyan-500 transition"
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