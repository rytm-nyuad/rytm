import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { formatLocalDate, getCanonicalTimeZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 366;

type CheckinPoint = {
  date: string;
  energy: number | null;
  focus: number | null;
  productivity: number | null;
  mood: number | null;
  stress: number | null;
  overall: number | null;
};

type NutritionDay = {
  date: string;
  total_kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  sugar_g: number | null;
  meal_count: number;
  confidence: number | null;
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
};

type FitbitPoint = {
  date: string;
  steps: number | null;
  active_minutes: number | null;
  sedentary_minutes: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_score: number | null;
  hrv_rmssd: number | null;
  calories_out: number | null;
};

function addDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function emptyCheckin(date: string): CheckinPoint {
  return {
    date,
    energy: null,
    focus: null,
    productivity: null,
    mood: null,
    stress: null,
    overall: null,
  };
}

function emptyFitbit(date: string): FitbitPoint {
  return {
    date,
    steps: null,
    active_minutes: null,
    sedentary_minutes: null,
    resting_hr: null,
    sleep_hours: null,
    sleep_score: null,
    hrv_rmssd: null,
    calories_out: null,
  };
}

export async function GET(request: Request) {
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
        },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month'); // YYYY-MM for monthly mode
    const daysRaw = Number(url.searchParams.get('days') || DEFAULT_DAYS);
    const nutritionDaysRaw = Number(url.searchParams.get('nutrition_days') || 0);

    const tz = await getCanonicalTimeZone(supabase, user.id);
    const today = formatLocalDate(new Date(), tz);

    let start: string;
    let end: string;
    let days: number;

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number);
      start = `${monthParam}-01`;
      const last = new Date(Date.UTC(y, m, 0));
      end = last.toISOString().slice(0, 10);
      if (end > today) end = today;
      days = Math.max(
        1,
        Math.round(
          (Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) /
            (24 * 60 * 60 * 1000)
        ) + 1
      );
    } else {
      days = Math.min(
        MAX_DAYS,
        Math.max(30, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : DEFAULT_DAYS)
      );
      end = today;
      start = addDays(end, -(days - 1));
    }

    const nutritionWindow = Math.min(
      MAX_DAYS,
      Math.max(
        days,
        Number.isFinite(nutritionDaysRaw) && nutritionDaysRaw > 0
          ? Math.floor(nutritionDaysRaw)
          : days
      )
    );
    const nutritionStart = addDays(today, -(nutritionWindow - 1));

    const [
      { data: checkins, error: checkinError },
      { data: overalls, error: overallError },
      { data: nutrition, error: nutritionError },
      { data: activity, error: activityError },
      { data: sleep, error: sleepError },
      { data: hrv, error: hrvError },
    ] = await Promise.all([
      supabase
        .from('daily_checkins')
        .select(
          'checkin_date, energy_score, focus_score, workload_score, mood_score, stress_score'
        )
        .eq('user_id', user.id)
        .gte('checkin_date', start)
        .lte('checkin_date', end)
        .order('checkin_date', { ascending: true }),
      supabase
        .from('daily_overall')
        .select('date, overall_score')
        .eq('user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true }),
      supabase
        .from('daily_nutrition2')
        .select(
          [
            'date',
            'total_kcal_day',
            'protein_g_day',
            'carbs_g_day',
            'fat_g_day',
            'sugar_g_day',
            'meal_count_day',
            'nutrition_confidence_day',
            'breakfast_logged',
            'lunch_logged',
            'dinner_logged',
          ].join(', ')
        )
        .eq('user_id', user.id)
        .gte('date', nutritionStart)
        .lte('date', today)
        .order('date', { ascending: true }),
      supabase
        .from('fitbit_activity_daily')
        .select(
          'date, steps, lightly_active_minutes, fairly_active_minutes, very_active_minutes, sedentary_minutes, resting_heart_rate, energy_burned_calories_out'
        )
        .eq('app_user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true }),
      supabase
        .from('fitbit_sleep_daily')
        .select('date, minutes_asleep, sleep_score')
        .eq('app_user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true }),
      supabase
        .from('fitbit_hrv_daily')
        .select('date, hrv_daily_rmssd')
        .eq('app_user_id', user.id)
        .gte('date', start)
        .lte('date', end)
        .order('date', { ascending: true }),
    ]);

    // Soft-fail optional tables (schema may not be applied for all users/envs).
    if (checkinError) throw new Error(checkinError.message);
    if (overallError) throw new Error(overallError.message);

    const byDate = new Map<string, CheckinPoint>();
    const fitbitByDate = new Map<string, FitbitPoint>();
    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      if (date > end) break;
      byDate.set(date, emptyCheckin(date));
      fitbitByDate.set(date, emptyFitbit(date));
    }

    for (const row of checkins || []) {
      const date = String(row.checkin_date);
      const point = byDate.get(date);
      if (!point) continue;
      point.energy = toNum(row.energy_score);
      point.focus = toNum(row.focus_score);
      point.productivity = toNum(row.workload_score);
      point.mood = toNum(row.mood_score);
      point.stress = toNum(row.stress_score);
    }

    for (const row of overalls || []) {
      const date = String(row.date);
      const point = byDate.get(date);
      if (!point) continue;
      point.overall = toNum(row.overall_score);
    }

    const series = Array.from(byDate.values());
    const loggedDays = series.filter(
      (d) =>
        d.energy !== null ||
        d.focus !== null ||
        d.productivity !== null ||
        d.mood !== null ||
        d.stress !== null ||
        d.overall !== null
    ).length;

    const nutritionDays: NutritionDay[] = (nutritionError ? [] : nutrition || [])
      .map((row) => ({
        date: String(row.date),
        total_kcal: toNum(row.total_kcal_day),
        protein_g: toNum(row.protein_g_day),
        carbs_g: toNum(row.carbs_g_day),
        fat_g: toNum(row.fat_g_day),
        sugar_g: toNum(row.sugar_g_day),
        meal_count: toNum(row.meal_count_day) ?? 0,
        confidence: toNum(row.nutrition_confidence_day),
        breakfast: !!row.breakfast_logged,
        lunch: !!row.lunch_logged,
        dinner: !!row.dinner_logged,
      }))
      .filter((d) => d.meal_count > 0 || (d.total_kcal ?? 0) > 0);

    if (!activityError) {
      for (const row of activity || []) {
        const date = String(row.date);
        const point = fitbitByDate.get(date);
        if (!point) continue;
        point.steps = toNum(row.steps);
        const light = toNum(row.lightly_active_minutes) ?? 0;
        const fair = toNum(row.fairly_active_minutes) ?? 0;
        const very = toNum(row.very_active_minutes) ?? 0;
        point.active_minutes = light + fair + very;
        point.sedentary_minutes = toNum(row.sedentary_minutes);
        point.resting_hr = toNum(row.resting_heart_rate);
        point.calories_out = toNum(row.energy_burned_calories_out);
      }
    }
    if (!sleepError) {
      for (const row of sleep || []) {
        const date = String(row.date);
        const point = fitbitByDate.get(date);
        if (!point) continue;
        const asleep = toNum(row.minutes_asleep);
        point.sleep_hours =
          asleep === null ? null : Math.round((asleep / 60) * 10) / 10;
        point.sleep_score = toNum(row.sleep_score);
      }
    }
    if (!hrvError) {
      for (const row of hrv || []) {
        const date = String(row.date);
        const point = fitbitByDate.get(date);
        if (!point) continue;
        point.hrv_rmssd = toNum(row.hrv_daily_rmssd);
      }
    }

    const fitbitSeries = Array.from(fitbitByDate.values());
    const fitbitLogged = fitbitSeries.filter(
      (d) =>
        d.steps !== null ||
        d.sleep_hours !== null ||
        d.hrv_rmssd !== null ||
        d.active_minutes !== null
    ).length;

    return NextResponse.json({
      days,
      start,
      end,
      month: monthParam || null,
      timezone: tz,
      logged_days: loggedDays,
      series,
      metrics: [
        { key: 'energy', label: 'Energy', color: '#3b82f6', colorDark: '#93c5fd' },
        { key: 'focus', label: 'Focus', color: '#6d28d9', colorDark: '#c4b5fd' },
        { key: 'productivity', label: 'Productivity', color: '#4338ca', colorDark: '#a5b4fc' },
        { key: 'mood', label: 'Mood', color: '#7c3aed', colorDark: '#ddd6fe' },
        { key: 'stress', label: 'Stress', color: '#be123c', colorDark: '#fda4af' },
        { key: 'overall', label: 'Overall', color: '#1d4ed8', colorDark: '#bfdbfe' },
      ],
      nutrition: {
        days: nutritionDays,
        error: nutritionError?.message || null,
      },
      fitbit: {
        series: fitbitSeries,
        logged_days: fitbitLogged,
        error:
          activityError?.message || sleepError?.message || hrvError?.message || null,
        metrics: [
          { key: 'steps', label: 'Steps', color: '#2563eb', colorDark: '#93c5fd', maxHint: 15000 },
          {
            key: 'active_minutes',
            label: 'Active minutes',
            color: '#4f46e5',
            colorDark: '#a5b4fc',
            maxHint: 180,
          },
          {
            key: 'sleep_hours',
            label: 'Sleep (hours)',
            color: '#6d28d9',
            colorDark: '#c4b5fd',
            maxHint: 10,
          },
          {
            key: 'sleep_score',
            label: 'Sleep score',
            color: '#7c3aed',
            colorDark: '#ddd6fe',
            maxHint: 100,
          },
          {
            key: 'hrv_rmssd',
            label: 'HRV (RMSSD)',
            color: '#4338ca',
            colorDark: '#c7d2fe',
            maxHint: 100,
          },
          {
            key: 'resting_hr',
            label: 'Resting HR',
            color: '#be123c',
            colorDark: '#fda4af',
            maxHint: 100,
          },
        ],
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load progress';
    console.error('[analytics/progress]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
