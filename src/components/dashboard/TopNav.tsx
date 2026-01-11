"use client";

import Link from "next/link";
import { useState } from "react"; 
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  LayoutDashboard,
  Calendar,
  Dumbbell,
  BarChart3,
  Trophy,
  Settings,
  LogOut,
  Menu,      
  X,
} from "lucide-react";

// CHANGE: DEV flag (temporary, for UI work)
const DEV_MODE = true;


export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

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
    { href: "/calendar", icon: Calendar, label: "Calendar" },
    { href: "/exercise", icon: Dumbbell, label: "Exercise" },
    { href: "/analytics", icon: BarChart3, label: "Analytics" },
    { href: "/leaderboard", icon: Trophy, label: "Leaderboard" },
    { href: "/settings", icon: Settings, label: "Settings" },
  ];

  const handleSignOut = async () => {
    if (!supabase) return;

    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  return (
    <nav className="relative h-14 bg-zinc-950 border-b border-zinc-800 flex items-center px-4 sm:px-6">
      {/* ================================================= */}
      {/* LEFT: Brand */}
      {/* ================================================= */}
      <div className="text-white font-bold text-lg tracking-wide">
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
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        {/* KEEP: Sign out (desktop) */}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-red-400 hover:bg-zinc-900 transition-all ml-2"
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
        className="ml-auto md:hidden text-zinc-400 hover:text-white transition"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* ================================================= */}
      {/* MOBILE DROPDOWN */}
      {/* ================================================= */}
      {mobileOpen && (
        <div className="absolute top-14 left-0 w-full bg-zinc-950 border-t border-zinc-800 md:hidden z-50">
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
                      ? "bg-white text-black"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-900"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            {/* MOBILE SIGN OUT */}
            <button
              onClick={handleSignOut}
              className="mt-2 flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-red-400 hover:bg-zinc-900 transition"
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