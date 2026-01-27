"use client";

import { BarChart3, TrendingUp, Activity } from "lucide-react";
import { TopNav } from "@/components/dashboard/TopNav";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function AnalyticsPage() {
  return (
    <ThemeProvider>
      <div className="min-h-screen dark:bg-black light:bg-gradient-to-br light:from-blue-50 light:to-indigo-50">
        <TopNav />
        
        <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
          <div className="text-center max-w-2xl mx-auto">
            {/* Icon */}
            <div className="mb-8 flex justify-center">
              <div className="relative">
                <div className="absolute inset-0 dark:bg-purple-600/20 light:bg-blue-600/20 blur-3xl rounded-full"></div>
                <BarChart3 className="relative w-24 h-24 dark:text-purple-500 light:text-blue-600 animate-pulse" />
              </div>
            </div>

            {/* Title */}
            <h1 className="text-4xl sm:text-5xl font-bold dark:text-white light:text-slate-900 mb-4">
              Analytics
            </h1>
            
            {/* Subtitle */}
            <p className="text-lg dark:text-zinc-400 light:text-slate-600 mb-2">
              Deep insights into your wellness journey are on the way
            </p>
            <p className="text-sm dark:text-zinc-500 light:text-slate-500 mb-8">
              Coming after baseline is defined.
            </p>

            {/* Feature Pills */}
            <div className="flex flex-wrap justify-center gap-3 mb-12">
              <div className="flex items-center gap-2 px-4 py-2 rounded-full dark:bg-zinc-900 light:bg-white dark:border-zinc-800 light:border-slate-200 border">
                <TrendingUp className="w-4 h-4 dark:text-purple-500 light:text-blue-600" />
                <span className="text-sm dark:text-zinc-300 light:text-slate-700">Trend Analysis</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full dark:bg-zinc-900 light:bg-white dark:border-zinc-800 light:border-slate-200 border">
                <Activity className="w-4 h-4 dark:text-purple-500 light:text-blue-600" />
                <span className="text-sm dark:text-zinc-300 light:text-slate-700">Progress Tracking</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-full dark:bg-zinc-900 light:bg-white dark:border-zinc-800 light:border-slate-200 border">
                <BarChart3 className="w-4 h-4 dark:text-purple-500 light:text-blue-600" />
                <span className="text-sm dark:text-zinc-300 light:text-slate-700">Data Visualization</span>
              </div>
            </div>

            {/* Coming Soon Badge */}
            <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full dark:bg-gradient-to-r dark:from-purple-600 dark:to-purple-700 light:bg-gradient-to-r light:from-blue-600 light:to-blue-700 text-white">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
              </span>
              <span className="font-semibold">Coming Soon</span>
            </div>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
