"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

interface CalendarPickerProps {
  selectedDate: string; // YYYY-MM-DD
  maxDate: string; // YYYY-MM-DD
  onDateChange: (date: string) => void;
}

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Format a Date using local calendar parts (never toISOString — that shifts the day in UTC+ offsets). */
function formatLocalDate(d: Date): string {
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}

function addDays(dateStr: string, delta: number): string {
  const { year, month, day } = parseDate(dateStr);
  const d = new Date(year, month, day);
  d.setDate(d.getDate() + delta);
  return formatLocalDate(d);
}

function formatLabel(dateStr: string, today: string): string {
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  const { year, month, day } = parseDate(dateStr);
  const d = new Date(year, month, day);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function CalendarPicker({ selectedDate, maxDate, onDateChange }: CalendarPickerProps) {
  const [open, setOpen] = useState(false);
  const { year: selYear, month: selMonth } = parseDate(selectedDate);
  const [viewYear, setViewYear] = useState(selYear);
  const [viewMonth, setViewMonth] = useState(selMonth);
  const ref = useRef<HTMLDivElement>(null);

  // Sync view when selectedDate changes externally
  useEffect(() => {
    const { year, month } = parseDate(selectedDate);
    setViewYear(year);
    setViewMonth(month);
  }, [selectedDate]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const navigateMonth = (dir: -1 | 1) => {
    let m = viewMonth + dir;
    let y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  };

  const navigateDate = (dir: -1 | 1) => {
    const newDate = addDays(selectedDate, dir);
    if (newDate <= maxDate) {
      onDateChange(newDate);
    }
  };

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const cells: { day: number; dateStr: string; inMonth: boolean }[] = [];

  // Previous month fill
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    let pm = viewMonth - 1, py = viewYear;
    if (pm < 0) { pm = 11; py--; }
    cells.push({ day: d, dateStr: toDateStr(py, pm, d), inMonth: false });
  }
  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, dateStr: toDateStr(viewYear, viewMonth, d), inMonth: true });
  }
  // Next month fill
  const remaining = 7 - (cells.length % 7);
  if (remaining < 7) {
    let nm = viewMonth + 1, ny = viewYear;
    if (nm > 11) { nm = 0; ny++; }
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, dateStr: toDateStr(ny, nm, d), inMonth: false });
    }
  }

  const isToday = selectedDate === maxDate;
  const canGoForward = addDays(selectedDate, 1) <= maxDate;

  return (
    <div ref={ref} className="relative">
      {/* Compact date nav */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigateDate(-1)}
          className="p-1.5 rounded-lg dark:hover:bg-zinc-800 hover:bg-zinc-200 transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
        </button>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`
            flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
            ${open
              ? "dark:bg-zinc-800 bg-zinc-200 dark:text-white text-zinc-900"
              : "dark:hover:bg-zinc-800 hover:bg-zinc-200 dark:text-zinc-300 text-zinc-600"
            }
          `}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>{formatLabel(selectedDate, maxDate)}</span>
          {isToday && (
            <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-violet-500" />
          )}
        </button>

        <button
          type="button"
          onClick={() => navigateDate(1)}
          disabled={!canGoForward}
          className="p-1.5 rounded-lg dark:hover:bg-zinc-800 hover:bg-zinc-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Next day"
        >
          <ChevronRight className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
        </button>
      </div>

      {/* Calendar dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-700 border-zinc-200 shadow-xl dark:shadow-black/50 shadow-zinc-200/50 p-3 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Month/Year header */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => navigateMonth(-1)}
              className="p-1 rounded-md dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
            </button>
            <span className="text-sm font-semibold dark:text-white text-zinc-900">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => navigateMonth(1)}
              className="p-1 rounded-md dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] font-medium dark:text-zinc-500 text-zinc-400 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map(({ day, dateStr, inMonth }, i) => {
              const isSelected = dateStr === selectedDate;
              const isTodayCell = dateStr === maxDate;
              const isFuture = dateStr > maxDate;
              const disabled = isFuture || !inMonth;

              return (
                <button
                  key={i}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onDateChange(dateStr);
                    setOpen(false);
                  }}
                  className={`
                    relative w-full aspect-square flex items-center justify-center text-xs rounded-lg transition-all
                    ${disabled
                      ? "opacity-25 cursor-not-allowed"
                      : "cursor-pointer"
                    }
                    ${isSelected
                      ? "bg-violet-600 text-white font-semibold shadow-md shadow-violet-600/30"
                      : isTodayCell && !isSelected
                        ? "dark:text-violet-400 text-violet-600 font-semibold dark:hover:bg-zinc-800 hover:bg-zinc-100"
                        : inMonth
                          ? "dark:text-zinc-300 text-zinc-700 dark:hover:bg-zinc-800 hover:bg-zinc-100 font-medium"
                          : "dark:text-zinc-600 text-zinc-300"
                    }
                  `}
                >
                  {day}
                  {isTodayCell && !isSelected && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-violet-500" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Quick actions */}
          <div className="mt-2 pt-2 border-t dark:border-zinc-800 border-zinc-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onDateChange(maxDate);
                setOpen(false);
              }}
              className="text-xs font-medium dark:text-violet-400 text-violet-600 dark:hover:text-violet-300 hover:text-violet-700 transition-colors px-2 py-1 rounded-md dark:hover:bg-zinc-800 hover:bg-zinc-100"
            >
              Go to Today
            </button>
            <span className="text-[10px] dark:text-zinc-600 text-zinc-400">
              {selectedDate}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
