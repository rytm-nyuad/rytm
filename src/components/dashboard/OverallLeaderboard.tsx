"use client";

import { useState, useEffect } from "react";
import { Trophy, Crown, ChevronDown, ChevronUp, Star } from "lucide-react";
import {
  getOverallLeaderboard,
  OverallLeaderboardEntry,
} from "@/lib/db/leaderboard";

// ── Podium card for ranks 1-3 ────────────────────────

const PODIUM_STYLES: Record<
  number,
  { ring: string; bg: string; badge: string; badgeText: string; size: string }
> = {
  1: {
    ring: "ring-4 ring-yellow-500",
    bg: "bg-yellow-500/20",
    badge: "bg-yellow-500 text-black",
    badgeText: "",
    size: "w-16 h-16",
  },
  2: {
    ring: "ring-2 ring-zinc-400",
    bg: "bg-zinc-700",
    badge: "bg-zinc-400 text-black",
    badgeText: "",
    size: "w-14 h-14",
  },
  3: {
    ring: "ring-2 ring-amber-700",
    bg: "bg-zinc-700",
    badge: "bg-amber-700 text-white",
    badgeText: "",
    size: "w-14 h-14",
  },
};

function PodiumCard({ entry }: { entry: OverallLeaderboardEntry }) {
  const style = PODIUM_STYLES[entry.overallRank] ?? PODIUM_STYLES[3];
  const isFirst = entry.overallRank === 1;

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Avatar */}
      <div className="relative">
        <div
          className={`${style.size} rounded-full ${style.bg} overflow-hidden ${style.ring}`}
        >
          {entry.avatarUrl ? (
            <img
              src={entry.avatarUrl}
              alt={entry.fullName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-lg font-bold text-zinc-300">
              {entry.firstName[0]}
            </div>
          )}
        </div>

        {/* Rank badge */}
        <div
          className={`absolute -top-1 -right-1 w-6 h-6 rounded-full ${style.badge} flex items-center justify-center text-xs font-bold border-2 border-zinc-950`}
        >
          {isFirst ? <Crown className="w-3.5 h-3.5" /> : entry.overallRank}
        </div>
      </div>

      {/* Name */}
      <span className="text-xs font-medium text-zinc-300 text-center max-w-[72px] truncate">
        {entry.firstName}
      </span>

      {/* Points */}
      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-600/20">
        <Star className="w-3 h-3 text-purple-400" />
        <span className="text-xs font-bold text-white">
          {entry.totalPoints.toLocaleString()}
        </span>
      </div>

      {/* Delta */}
      {(entry.latestWeekPoints ?? 0) > 0 && (
        <span className="text-[10px] text-emerald-400 font-medium">
          +{entry.latestWeekPoints} this week
        </span>
      )}
    </div>
  );
}

// ── Compact row for ranks 4-10 ───────────────────────

function RankRow({ entry }: { entry: OverallLeaderboardEntry }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800">
      {/* Rank */}
      <span className="text-sm font-bold text-zinc-500 w-5 text-right">
        {entry.overallRank}
      </span>

      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-zinc-700 overflow-hidden flex-shrink-0">
        {entry.avatarUrl ? (
          <img
            src={entry.avatarUrl}
            alt={entry.fullName}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm font-bold text-zinc-400">
            {entry.firstName[0]}
          </div>
        )}
      </div>

      {/* Name */}
      <span className="flex-1 text-sm font-medium text-white truncate">
        {entry.fullName}
      </span>

      {/* Points */}
      <div className="flex items-center gap-1">
        <Star className="w-3 h-3 text-purple-400" />
        <span className="text-sm font-bold text-white">
          {entry.totalPoints.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────

export default function OverallLeaderboard() {
  const [entries, setEntries] = useState<OverallLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await getOverallLeaderboard(); // all rows
      setEntries(data);
      setLoading(false);
    })();
  }, []);

  const top3 = entries.slice(0, 3);
  const ranks4to10 = entries.slice(3, 10);
  const remaining = entries.slice(10);

  // ── Loading / empty states ──

  if (loading) {
    return (
      <aside className="w-full lg:w-80 flex-shrink-0">
        <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-5">
          <h3 className="text-base font-bold text-white flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-purple-400" />
            Overall Leaderboard
          </h3>
          <div className="text-center py-8 text-zinc-500 text-sm">
            Loading…
          </div>
        </div>
      </aside>
    );
  }

  if (entries.length === 0) {
    return (
      <aside className="w-full lg:w-80 flex-shrink-0">
        <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-5">
          <h3 className="text-base font-bold text-white flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-purple-400" />
            Overall Leaderboard
          </h3>
          <div className="text-center py-8 text-zinc-500 text-sm">
            No overall rankings yet.<br />
            Complete a weekly competition to appear here!
          </div>
        </div>
      </aside>
    );
  }

  // ── Render ──

  return (
    <aside className="w-full lg:w-80 flex-shrink-0">
      <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-5 sticky top-24 h-fit">
        {/* Header */}
        <h3 className="text-base font-bold text-white flex items-center gap-2 mb-5">
          <Trophy className="w-5 h-5 text-purple-400" />
          Overall Leaderboard
        </h3>

        {/* ── Top 3 Podium ── */}
        {top3.length > 0 && (
          <div className="flex items-end justify-center gap-4 mb-5">
            {/* 2nd */}
            {top3[1] && <PodiumCard entry={top3[1]} />}
            {/* 1st – slightly elevated */}
            {top3[0] && (
              <div className="-mt-3">
                <PodiumCard entry={top3[0]} />
              </div>
            )}
            {/* 3rd */}
            {top3[2] && <PodiumCard entry={top3[2]} />}
          </div>
        )}

        {/* Divider */}
        {ranks4to10.length > 0 && (
          <div className="border-t border-zinc-800 my-3" />
        )}

        {/* ── Ranks 4+ ── */}
        <div className={`space-y-1.5 ${expanded ? 'max-h-96 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-zinc-700' : ''}`}>
          {ranks4to10.map((entry) => (
            <RankRow key={entry.userId} entry={entry} />
          ))}
          {expanded && remaining.map((entry) => (
            <RankRow key={entry.userId} entry={entry} />
          ))}
        </div>

        {/* ── View More (11+) ── */}
        {remaining.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full mt-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors text-sm text-zinc-300 font-medium flex items-center justify-center gap-1"
          >
            {expanded ? (
              <>
                Show less <ChevronUp className="w-4 h-4" />
              </>
            ) : (
              <>
                View more ({remaining.length}) <ChevronDown className="w-4 h-4" />
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}
