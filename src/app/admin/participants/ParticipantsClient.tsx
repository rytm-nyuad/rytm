"use client";

import { useState, useMemo, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────
interface Summary {
  has_overall: boolean;
  has_checkin: boolean;
  has_journal: boolean;
  has_meal: boolean;
  is_complete: boolean;
  streak_value: number;
  is_backlogged: boolean;
  updated_at: string | null;
}

interface ParticipantRow {
  user_id: string;
  full_name: string | null;
  display_email: string | null;
  timezone: string | null;
  summary: Summary | null;
}

interface Props {
  initialDate: string;
  initialStudy: ParticipantRow[];
  initialOthers: ParticipantRow[];
}

// ── Helpers ────────────────────────────────────────────────────────────
function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function todayDubai(): string {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" })
  );
  return now.toISOString().split("T")[0];
}

function yesterdayDubai(): string {
  return shiftDate(todayDubai(), -1);
}

function formatUpdatedAt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function missingItems(s: Summary | null): string[] {
  if (!s) return [];
  const missing: string[] = [];
  if (!s.has_overall) missing.push("Overall");
  if (!s.has_checkin) missing.push("Check-in");
  if (!s.has_journal) missing.push("Journal");
  if (!s.has_meal) missing.push("Food");
  return missing;
}

function formatDisplayDate(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function filterAndSort(
  rows: ParticipantRow[],
  search: string,
  incompleteOnly: boolean,
  lateOnly: boolean
): ParticipantRow[] {
  let result = [...rows];
  const q = search.toLowerCase().trim();
  if (q) {
    result = result.filter(
      (r) =>
        r.full_name?.toLowerCase().includes(q) ||
        r.display_email?.toLowerCase().includes(q)
    );
  }
  if (incompleteOnly) {
    result = result.filter((r) => !r.summary || !r.summary.is_complete);
  }
  if (lateOnly) {
    result = result.filter((r) => r.summary?.is_backlogged === true);
  }
  result.sort((a, b) => {
    const aComplete = a.summary?.is_complete ? 1 : 0;
    const bComplete = b.summary?.is_complete ? 1 : 0;
    if (aComplete !== bComplete) return aComplete - bComplete;
    return (a.full_name ?? "").localeCompare(b.full_name ?? "");
  });
  return result;
}

// ── Component ──────────────────────────────────────────────────────────
export default function ParticipantsClient({
  initialDate,
  initialStudy,
  initialOthers,
}: Props) {
  const [date, setDate] = useState(initialDate);
  const [study, setStudy] = useState<ParticipantRow[]>(initialStudy);
  const [others, setOthers] = useState<ParticipantRow[]>(initialOthers);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepResult, setPrepResult] = useState<string | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────
  const fetchDate = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/daily-status?date=${d}`);
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setStudy(json.study ?? []);
      setOthers(json.others ?? []);
      setDate(d);
    } catch {
      // Keep current data on error
    } finally {
      setLoading(false);
    }
  }, []);

  const goTo = (d: string) => fetchDate(d);
  const goPrev = () => goTo(shiftDate(date, -1));
  const goNext = () => goTo(shiftDate(date, 1));
  const goYesterday = () => goTo(yesterdayDubai());
  const goToday = () => goTo(todayDubai());

  // ── Prep now ─────────────────────────────────────────────────────────
  const runPrep = async () => {
    setPrepLoading(true);
    setPrepResult(null);
    try {
      const res = await fetch("/api/admin/prep-daily-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const json = await res.json();
      if (res.ok) {
        setPrepResult(
          `Prepped ${json.participants_count} participants for ${json.date}`
        );
        fetchDate(date);
      } else {
        setPrepResult(`Error: ${json.error}`);
      }
    } catch {
      setPrepResult("Network error");
    } finally {
      setPrepLoading(false);
    }
  };

  // ── Filtering + sorting ──────────────────────────────────────────────
  const filteredStudy = useMemo(
    () => filterAndSort(study, search, incompleteOnly, lateOnly),
    [study, search, incompleteOnly, lateOnly]
  );
  const filteredOthers = useMemo(
    () => filterAndSort(others, search, incompleteOnly, lateOnly),
    [others, search, incompleteOnly, lateOnly]
  );

  // ── Counts (study only for top cards) ────────────────────────────────
  const total = study.length;
  const completeCount = study.filter((r) => r.summary?.is_complete).length;
  const incompleteCount = total - completeCount;
  const lateCount = study.filter((r) => r.summary?.is_backlogged).length;
  const missingRowCount = study.filter((r) => !r.summary).length;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <h1 className="text-xl font-semibold text-zinc-900">
            Admin · Participant Compliance
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Daily status by participant
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <div className="flex flex-wrap gap-3">
          <StatCard label="Participants" value={total} />
          <StatCard
            label="Complete"
            value={completeCount}
            color="text-emerald-600"
          />
          <StatCard
            label="Incomplete"
            value={incompleteCount}
            color="text-zinc-600"
          />
          <StatCard label="Late" value={lateCount} color="text-amber-600" />
          {missingRowCount > 0 && (
            <StatCard
              label="No Row"
              value={missingRowCount}
              color="text-red-500"
            />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={goPrev}
              className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              ← Prev
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => goTo(e.target.value)}
              className="h-8 rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <button
              onClick={goNext}
              className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              Next →
            </button>
            <button
              onClick={goYesterday}
              className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-500 hover:bg-zinc-50 transition-colors"
            >
              Yesterday
            </button>
            <button
              onClick={goToday}
              className="inline-flex h-8 items-center rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-500 hover:bg-zinc-50 transition-colors"
            >
              Today
            </button>
            <span className="ml-auto text-sm font-medium text-zinc-800">
              {formatDisplayDate(date)}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-700 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
            <Toggle
              label="Incomplete only"
              checked={incompleteOnly}
              onChange={setIncompleteOnly}
            />
            <Toggle
              label="Late only"
              checked={lateOnly}
              onChange={setLateOnly}
            />
            <button
              onClick={runPrep}
              disabled={prepLoading}
              className="ml-auto inline-flex h-8 items-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {prepLoading ? "Running…" : "Run Prep"}
            </button>
          </div>

          {prepResult && (
            <p className="mt-1 text-xs text-zinc-500">{prepResult}</p>
          )}
        </div>
      </div>

      {/* ── Study Participants Table ─────────────────────────────────── */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-4">
        <h2 className="mt-5 mb-2 text-sm font-semibold text-zinc-700">
          Study Participants ({filteredStudy.length})
        </h2>
        <ParticipantTable rows={filteredStudy} loading={loading} />

        {/* ── Other Accounts (collapsed) ─────────────────────────────── */}
        <div className="mt-8 rounded-lg border border-zinc-200">
          <button
            onClick={() => setOthersOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            <span>
              Other accounts{" "}
              <span className="ml-1 inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">
                {others.length}
              </span>
            </span>
            <span className="text-zinc-400">{othersOpen ? "▲" : "▼"}</span>
          </button>
          {othersOpen && (
            <div className="border-t border-zinc-200">
              <ParticipantTable rows={filteredOthers} loading={loading} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Table component (reused for both sections) ─────────────────────────
function ParticipantTable({
  rows,
  loading,
}: {
  rows: ParticipantRow[];
  loading: boolean;
}) {
  return (
    <div className="overflow-x-auto overflow-y-auto max-h-[65vh] rounded-lg border border-zinc-200 bg-white">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="sticky top-0 z-20">
            <th className="border-b border-black/10 bg-white px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Participant
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Overall
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Check-in
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Journal
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Food
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Complete
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Streak
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-center text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Late
            </th>
            <th className="border-b border-black/10 bg-white px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-black/60 whitespace-nowrap">
              Last Update
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={9} className="px-3 py-12 text-center text-zinc-400">
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-3 py-12 text-center text-zinc-400">
                No participants found
              </td>
            </tr>
          ) : (
            rows.map((r) => <ParticipantRowComp key={r.user_id} row={r} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color = "text-zinc-900",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span className={`text-lg font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-zinc-300 text-zinc-800 focus:ring-zinc-400"
      />
      {label}
    </label>
  );
}

function BoolCell({ value }: { value: boolean | undefined | null }) {
  if (value === true) {
    return <span className="text-emerald-500">✅</span>;
  }
  return <span className="text-zinc-300">—</span>;
}

function ParticipantRowComp({ row }: { row: ParticipantRow }) {
  const s = row.summary;
  const noRow = !s;
  const incomplete = noRow || !s?.is_complete;
  const missing = missingItems(s);

  return (
    <tr
      className={`transition-colors ${
        incomplete ? "bg-rose-50/40" : "hover:bg-zinc-50"
      }`}
    >
      {/* Participant */}
      <td className="px-3 py-3 text-sm leading-5">
        <div className="font-medium text-zinc-900">
          {row.full_name || "—"}
        </div>
        <div className="text-xs text-zinc-400">{row.display_email || "—"}</div>
        {missing.length > 0 && (
          <div className="mt-0.5 text-[10px] text-rose-400">
            Missing: {missing.join(", ")}
          </div>
        )}
      </td>

      {noRow ? (
        <>
          <td colSpan={4} className="px-3 py-3 text-sm leading-5 text-center">
            <span className="inline-block rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
              No row
            </span>
          </td>
          <td className="px-3 py-3 text-sm leading-5 text-center">
            <span className="inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
              No row
            </span>
          </td>
          <td className="px-3 py-3 text-sm leading-5 text-center text-zinc-300">—</td>
          <td className="px-3 py-3 text-sm leading-5 text-center" />
          <td className="px-3 py-3 text-sm leading-5 text-zinc-300">—</td>
        </>
      ) : (
        <>
          <td className="px-3 py-3 text-sm leading-5 text-center">
            <BoolCell value={s.has_overall} />
          </td>
          <td className="px-3 py-3 text-sm leading-5 text-center">
            <BoolCell value={s.has_checkin} />
          </td>
          <td className="px-3 py-3 text-sm leading-5 text-center">
            <BoolCell value={s.has_journal} />
          </td>
          <td className="px-3 py-3 text-sm leading-5 text-center">
            <BoolCell value={s.has_meal} />
          </td>

          <td className="px-3 py-3 text-sm leading-5 text-center">
            {s.is_complete ? (
              <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                Complete
              </span>
            ) : (
              <span className="inline-block rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                Incomplete
              </span>
            )}
          </td>

          <td className="px-3 py-3 text-sm leading-5 text-center font-medium text-zinc-700">
            {s.streak_value ?? 0}
          </td>

          <td className="px-3 py-3 text-sm leading-5 text-center">
            {s.is_backlogged ? (
              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                Late
              </span>
            ) : null}
          </td>

          <td className="px-3 py-3 text-xs leading-5 text-zinc-400">
            {formatUpdatedAt(s.updated_at)}
          </td>
        </>
      )}
    </tr>
  );
}
