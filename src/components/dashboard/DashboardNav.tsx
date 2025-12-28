"use client";

import Link from "next/link";
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
} from "lucide-react";

export function DashboardNav() {
  const pathname = usePathname();
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
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  return (
    <nav className="w-20 bg-zinc-950 border-l border-zinc-800 flex flex-col items-center py-8 justify-between">
      <div className="flex flex-col items-center space-y-6">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex flex-col items-center gap-1 transition-colors ${
                isActive ? "text-white" : "text-zinc-600 hover:text-zinc-400"
              }`}
              title={item.label}
            >
              <div
                className={`p-3 rounded-xl transition-all ${
                  isActive
                    ? "bg-white text-black"
                    : "bg-transparent group-hover:bg-zinc-900"
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Sign Out Button */}
      <button
        onClick={handleSignOut}
        className="group flex flex-col items-center gap-1 transition-colors text-zinc-600 hover:text-red-400"
        title="Sign Out"
      >
        <div className="p-3 rounded-xl transition-all bg-transparent group-hover:bg-zinc-900">
          <LogOut className="w-5 h-5" />
        </div>
        <span className="text-[10px] font-medium">Sign Out</span>
      </button>
    </nav>
  );
}
