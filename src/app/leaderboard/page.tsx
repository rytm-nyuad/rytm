"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Crown, Trophy } from "lucide-react";
import { getLeaderboard, LeaderboardEntry } from "@/lib/db/leaderboard";

export default function LeaderboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    setLoading(true);
    console.log("Loading leaderboard...");
    const data = await getLeaderboard();
    console.log("Leaderboard loaded:", data.length, "entries");
    setLeaderboard(data);
    setLoading(false);
  };

  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  const displayedRest = showAll ? rest : rest.slice(0, 2);

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

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12 text-zinc-500">Loading...</div>
        ) : (
          <>
            {/* Top 3 Podium */}
            {top3.length > 0 && (
              <div className="mb-8">
                <div className="relative h-96 flex items-end justify-center gap-4">
                  {/* 2nd Place */}
                  {top3[1] && (
                    <div className="flex flex-col items-center">
                      <div className="relative mb-3">
                        <div className="w-16 h-16 rounded-full bg-zinc-700 overflow-hidden ring-2 ring-zinc-600">
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
                      <div className="text-sm font-medium text-zinc-300 mb-1 text-center max-w-[80px] truncate">
                        {top3[1].firstName}
                      </div>
                      <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600/20">
                        <Trophy className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-bold text-white">{top3[1].streak}</span>
                      </div>
                      <div className="mt-3 w-28 h-32 rounded-t-xl bg-zinc-800 flex items-center justify-center text-6xl font-bold text-zinc-700">
                        2
                      </div>
                    </div>
                  )}

                  {/* 1st Place */}
                  {top3[0] && (
                    <div className="flex flex-col items-center -mt-12">
                      <div className="relative mb-3">
                        <div className="w-20 h-20 rounded-full bg-yellow-500/20 overflow-hidden ring-4 ring-yellow-500">
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
                      <div className="text-base font-bold text-white mb-1 text-center max-w-[100px] truncate">
                        {top3[0].firstName}
                      </div>
                      <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600/20">
                        <Trophy className="w-4 h-4 text-purple-400" />
                        <span className="text-base font-bold text-white">{top3[0].streak}</span>
                      </div>
                      <div className="mt-3 w-32 h-44 rounded-t-xl bg-zinc-800 flex items-center justify-center text-8xl font-bold text-zinc-700">
                        1
                      </div>
                    </div>
                  )}

                  {/* 3rd Place */}
                  {top3[2] && (
                    <div className="flex flex-col items-center">
                      <div className="relative mb-3">
                        <div className="w-16 h-16 rounded-full bg-zinc-700 overflow-hidden ring-2 ring-zinc-600">
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
                      <div className="text-sm font-medium text-zinc-300 mb-1 text-center max-w-[80px] truncate">
                        {top3[2].firstName}
                      </div>
                      <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600/20">
                        <Trophy className="w-4 h-4 text-purple-400" />
                        <span className="text-sm font-bold text-white">{top3[2].streak}</span>
                      </div>
                      <div className="mt-3 w-28 h-24 rounded-t-xl bg-zinc-800 flex items-center justify-center text-5xl font-bold text-zinc-700">
                        3
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Rest of the list */}
            {rest.length > 0 && (
              <div className="space-y-2">
                {displayedRest.map((entry) => (
                  <div
                    key={entry.userId}
                    className="flex items-center gap-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800"
                  >
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
                      <div className="font-medium text-white truncate">{entry.fullName}</div>
                    </div>
                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600/20">
                      <Trophy className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-bold text-white">{entry.streak}</span>
                    </div>
                  </div>
                ))}

                {/* See More / See Less Button */}
                {rest.length > 2 && (
                  <button
                    onClick={() => setShowAll(!showAll)}
                    className="w-full py-3 mt-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 transition-colors text-white font-medium"
                  >
                    {showAll ? "See Less" : `See More (${rest.length - 2} more)`}
                  </button>
                )}
              </div>
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
  );
}
