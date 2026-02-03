"use client";

import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  LayoutDashboard,
  Calendar,
  Dumbbell,
  BarChart3,
  Trophy,
  Settings,
  LogOut,
  X,
} from "lucide-react";

interface NavModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NavModal({ isOpen, onClose }: NavModalProps) {
  const router = useRouter();

  const supabase = createBrowserClient(
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

  const handleNavClick = (href: string) => {
    router.push(href);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-8 pointer-events-none">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-8 w-full max-w-2xl pointer-events-auto animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-white">Navigation</h2>
            <button
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-white transition-colors rounded-lg hover:bg-zinc-800"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Nav Grid */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => handleNavClick(item.href)}
                  className="group flex flex-col items-center justify-center gap-3 p-6 bg-zinc-800 border border-zinc-700 rounded-2xl hover:bg-zinc-750 hover:border-zinc-600 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
                >
                  <div className="p-3 bg-white rounded-xl group-hover:scale-110 transition-transform duration-200">
                    <Icon className="w-6 h-6 text-black" />
                  </div>
                  <span className="text-sm font-medium text-white">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sign Out */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 p-4 bg-transparent border border-zinc-700 text-zinc-400 rounded-xl hover:bg-zinc-800 hover:text-red-400 hover:border-red-900 transition-all duration-200"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </div>
    </>
  );
}
