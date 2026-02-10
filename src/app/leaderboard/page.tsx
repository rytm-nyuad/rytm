"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crown, Trophy, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import {
  getWeeklyLeaderboard,
  WeeklyLeaderboardData,
  WeeklyLeaderboardEntry,
  formatMetricKey,
  formatMetricValue,
  formatSleepMinutesToClock,
  formatDurationMinutes,
} from "@/lib/db/leaderboard";
import OverallLeaderboard from "@/components/dashboard/OverallLeaderboard";

export default function LeaderboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leaderboardData, setLeaderboardData] = useState<WeeklyLeaderboardData | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    setLoading(true);
    console.log("Loading leaderboard...");
    const data = await getWeeklyLeaderboard();
    console.log("Leaderboard loaded:", data?.entries.length || 0, "entries");
    setLeaderboardData(data);
    setLoading(false);
  };

  const formatLastUpdated = (timestamp: string | null): string => {
    if (!timestamp) return "—";
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const getTitle = (): string => {
    if (!leaderboardData?.activeWeek) return "";
    if (leaderboardData.activeWeek.title) {
      return leaderboardData.activeWeek.title;
    }
    return `This Week: ${formatMetricKey(leaderboardData.activeWeek.metric_key)}`;
  };

  const formatWeekRange = (): string => {
    if (!leaderboardData?.activeWeek) return "";
    const start = new Date(leaderboardData.activeWeek.week_start);
    const end = new Date(leaderboardData.activeWeek.week_end);
    // Subtract 1 day from end since week_end is exclusive
    end.setDate(end.getDate() - 1);
    
    const formatDate = (d: Date) => {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    };
    
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const leaderboard = leaderboardData?.entries || [];
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const metricKey = leaderboardData?.activeWeek?.metric_key || "steps";
  const isSleep = metricKey === "sleep_consistency";

  // Helper to render sleep stats badge for podium / list
  const renderSleepStats = (entry: WeeklyLeaderboardEntry, compact = false) => {
    if (entry.scoreMinutes == null) return <span className="text-sm text-zinc-500">—</span>;
    const window = `${formatSleepMinutesToClock(entry.earliestSleepMinutesNorm)} : ${formatSleepMinutesToClock(entry.latestWakeMinutes)}`;
    if (compact) {
      return (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-xs text-zinc-400">{window}</span>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">R {formatDurationMinutes(entry.rangeMinutes)}</span>
            <span className="text-zinc-500">Avg {formatDurationMinutes(entry.avgSleepMinutes)}</span>
            <span className="font-bold text-white">{formatDurationMinutes(entry.scoreMinutes)}</span>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[11px] text-zinc-400 leading-tight">{window}</span>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <span>R {formatDurationMinutes(entry.rangeMinutes)}</span>
          <span>·</span>
          <span>Avg {formatDurationMinutes(entry.avgSleepMinutes)}</span>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-600/20">
          <Trophy className="w-3 h-3 text-purple-400" />
          <span className="text-xs font-bold text-white">{formatDurationMinutes(entry.scoreMinutes)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-full bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Leaderboard</h1>
        </div>
      </div>

      {/* Content — two-column layout */}
      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-8 lg:gap-12 items-start">
        {/* Left: Weekly Competition */}
        <div className="w-full lg:flex-1 flex justify-center">
        <div className="w-full max-w-2xl">
        {loading ? (
          <div className="text-center py-12 text-zinc-500">Loading...</div>
        ) : !leaderboardData?.activeWeek ? (
          <div className="text-center py-12 text-zinc-500">
            No active competition this week
          </div>
        ) : (
          <>
            {/* Dynamic Title */}
            <div className="mb-3 text-center">
              <h2 className="text-xl font-bold text-white">{getTitle()}</h2>
              <p className="text-sm text-zinc-400 mt-0.5">{formatWeekRange()}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Last updated: {formatLastUpdated(leaderboardData.lastUpdated)}
              </p>
            </div>

            {/* Top 3 Podium */}
            {top3.length > 0 && (
              <div className="mb-4">
                <div className="relative h-72 flex items-end justify-center gap-3">
                  {/* 2nd Place */}
                  {top3[1] && (
                    <div className="flex flex-col items-center">
                      <div className="relative mb-2">
                        <div className="w-14 h-14 rounded-full bg-zinc-700 overflow-hidden ring-2 ring-zinc-600">
                          {top3[1].avatarUrl ? (
                            <img src={top3[1].avatarUrl} alt={top3[1].fullName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-bold text-zinc-400">
                              {top3[1].firstName[0]}
                            </div>
                          )}
                        </div>
                        <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-zinc-600 flex items-center justify-center text-white font-bold text-sm border-2 border-zinc-950">
                          2
                        </div>
                      </div>
                      <div className="text-xs font-medium text-zinc-300 mb-0.5 text-center max-w-[70px] truncate">
                        {top3[1].firstName}
                        {top3[1].fitbitStatus === 'needs_reauth' && (
                          <AlertCircle className="inline w-3 h-3 ml-1 text-red-400" aria-label="Out of sync - reconnect Fitbit" />
                        )}
                      </div>
                      {isSleep ? renderSleepStats(top3[1]) : (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-600/20">
                          <Trophy className="w-3 h-3 text-purple-400" />
                          <span className="text-xs font-bold text-white">{formatMetricValue(top3[1].value, metricKey)}</span>
                        </div>
                      )}
                      <div className="mt-2 w-24 h-24 rounded-t-xl bg-zinc-800 flex items-center justify-center text-5xl font-bold text-zinc-700">
                        2
                      </div>
                    </div>
                  )}

                  {/* 1st Place */}
                  {top3[0] && (
                    <div className="flex flex-col items-center -mt-8">
                      <div className="relative mb-2">
                        <div className="w-16 h-16 rounded-full bg-yellow-500/20 overflow-hidden ring-3 ring-yellow-500">
                          {top3[0].avatarUrl ? (
                            <img src={top3[0].avatarUrl} alt={top3[0].fullName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-yellow-600">
                              {top3[0].firstName[0]}
                            </div>
                          )}
                        </div>
                        <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-yellow-500 flex items-center justify-center text-black font-bold border-2 border-zinc-950">
                          <Crown className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="text-sm font-bold text-white mb-0.5 text-center max-w-[80px] truncate">
                        {top3[0].firstName}
                        {top3[0].fitbitStatus === 'needs_reauth' && (
                          <AlertCircle className="inline w-3 h-3 ml-1 text-red-400" aria-label="Out of sync - reconnect Fitbit" />
                        )}
                      </div>
                      {isSleep ? renderSleepStats(top3[0]) : (
                        <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-purple-600/20">
                          <Trophy className="w-3.5 h-3.5 text-purple-400" />
                          <span className="text-sm font-bold text-white">{formatMetricValue(top3[0].value, metricKey)}</span>
                        </div>
                      )}
                      <div className="mt-2 w-28 h-32 rounded-t-xl bg-zinc-800 flex items-center justify-center text-6xl font-bold text-zinc-700">
                        1
                      </div>
                    </div>
                  )}

                  {/* 3rd Place */}
                  {top3[2] && (
                    <div className="flex flex-col items-center">
                      <div className="relative mb-2">
                        <div className="w-14 h-14 rounded-full bg-zinc-700 overflow-hidden ring-2 ring-zinc-600">
                          {top3[2].avatarUrl ? (
                            <img src={top3[2].avatarUrl} alt={top3[2].fullName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-xl font-bold text-zinc-400">
                              {top3[2].firstName[0]}
                            </div>
                          )}
                        </div>
                        <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-amber-700 flex items-center justify-center text-white font-bold text-sm border-2 border-zinc-950">
                          3
                        </div>
                      </div>
                      <div className="text-xs font-medium text-zinc-300 mb-0.5 text-center max-w-[70px] truncate">
                        {top3[2].firstName}
                        {top3[2].fitbitStatus === 'needs_reauth' && (
                          <AlertCircle className="inline w-3 h-3 ml-1 text-red-400" aria-label="Out of sync - reconnect Fitbit" />
                        )}
                      </div>
                      {isSleep ? renderSleepStats(top3[2]) : (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-purple-600/20">
                          <Trophy className="w-3 h-3 text-purple-400" />
                          <span className="text-xs font-bold text-white">{formatMetricValue(top3[2].value, metricKey)}</span>
                        </div>
                      )}
                      <div className="mt-2 w-24 h-18 rounded-t-xl bg-zinc-800 flex items-center justify-center text-4xl font-bold text-zinc-700">
                        3
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rest of the list */}
            {rest.length > 0 && (
              <>
                <div className={`space-y-1.5 ${showAll ? 'max-h-96 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-700' : ''}`}>
                  {rest.slice(0, 2).map((entry) => (
                    <div
                      key={entry.userId}
                      className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800"
                    >
                      {/* Top line: Rank + Avatar + Name */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="text-lg font-bold text-zinc-500 w-8">{entry.rank}</div>
                        <div className="w-12 h-12 rounded-full bg-zinc-700 overflow-hidden flex-shrink-0">
                          {entry.avatarUrl ? (
                            <img src={entry.avatarUrl} alt={entry.fullName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-bold text-zinc-400">
                              {entry.firstName[0]}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate flex items-center gap-1">
                            {entry.fullName}
                            {entry.fitbitStatus === 'needs_reauth' && (
                              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" aria-label="Out of sync - reconnect Fitbit" />
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Bottom line on mobile, right side on desktop: Stats */}
                      <div className="flex justify-end lg:justify-start pl-14 lg:pl-0">
                        {isSleep ? renderSleepStats(entry, true) : (
                          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600/20">
                            <Trophy className="w-4 h-4 text-purple-400" />
                            <span className="text-sm font-bold text-white">{formatMetricValue(entry.value, metricKey)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {showAll && rest.slice(2).map((entry) => (
                    <div
                      key={entry.userId}
                      className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800"
                    >
                      {/* Top line: Rank + Avatar + Name */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="text-lg font-bold text-zinc-500 w-8">{entry.rank}</div>
                        <div className="w-12 h-12 rounded-full bg-zinc-700 overflow-hidden flex-shrink-0">
                          {entry.avatarUrl ? (
                            <img src={entry.avatarUrl} alt={entry.fullName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-bold text-zinc-400">
                              {entry.firstName[0]}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-white truncate flex items-center gap-1">
                            {entry.fullName}
                            {entry.fitbitStatus === 'needs_reauth' && (
                              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" aria-label="Out of sync - reconnect Fitbit" />
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Bottom line on mobile, right side on desktop: Stats */}
                      <div className="flex justify-end lg:justify-start pl-14 lg:pl-0">
                        {isSleep ? renderSleepStats(entry, true) : (
                          <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600/20">
                            <Trophy className="w-4 h-4 text-purple-400" />
                            <span className="text-sm font-bold text-white">{formatMetricValue(entry.value, metricKey)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* View More Button */}
                {rest.length > 2 && (
                  <button
                    onClick={() => setShowAll((v) => !v)}
                    className="w-full mt-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-sm text-zinc-300 font-medium flex items-center justify-center gap-1"
                  >
                    {showAll ? (
                      <>
                        Show less <ChevronUp className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        View more ({rest.length - 2}) <ChevronDown className="w-4 h-4" />
                      </>
                    )}
                  </button>
                )}
              </>
            )}

            {leaderboard.length === 0 && !loading && (
              <div className="text-center py-12 text-zinc-500">
                No leaderboard data available yet
              </div>
            )}
          </>
        )}
        </div>
        </div>

        {/* Right: Overall Leaderboard — always visible */}
        <OverallLeaderboard />
      </div>
    </div>
  );
}
