import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { runMorningPreparationForSubmissionDate, syncCoachJournalContextForSubmissionDate } from '@/lib/overall-submission-workflows';
import { getCoachReadiness } from '@/lib/coach/readiness';
import { refreshFitbitProfileTimezoneForUser } from '@/lib/fitbit';
import { formatLocalDate, getCanonicalTimeZone, shiftLocalDate } from '@/lib/time';
import {
  getBehaviorProfileDueState,
  hasRunningBehaviorProfileJob,
} from '@/lib/coach/behavior-profile';
import {
  getCorrelationArchetypeDueState,
  hasRunningCorrelationArchetypeJob,
} from '@/lib/coach/correlation-archetype';

export const dynamic = 'force-dynamic';

async function getExistingPreparationStatus(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionLocalDate: string
) {
  const [bundleResult, stateHistoryResult, currentStateResult] = await Promise.all([
    supabaseAdmin
      .from('daily_input_bundle_v12')
      .select('date')
      .eq('user_id', userId)
      .eq('date', submissionLocalDate)
      .maybeSingle(),
    supabaseAdmin
      .from('user_state_history2')
      .select('date, state_snapshot_json')
      .eq('user_id', userId)
      .eq('date', submissionLocalDate)
      .maybeSingle(),
    supabaseAdmin
      .from('user_state_current2')
      .select('as_of_date, state_json')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const bundleExists = !!bundleResult.data;
  const stateHistory = stateHistoryResult.data as
    | { date: string; state_snapshot_json?: { uncertainty?: { baseline_stability_flags?: { fast_ready?: boolean; slow_ready?: boolean } } } }
    | null;
  const currentState = currentStateResult.data as
    | { as_of_date: string; state_json?: { uncertainty?: { baseline_stability_flags?: { fast_ready?: boolean; slow_ready?: boolean } } } }
    | null;

  const currentFlags =
    currentState?.as_of_date === submissionLocalDate
      ? currentState.state_json?.uncertainty?.baseline_stability_flags
      : null;
  const historyFlags = stateHistory?.state_snapshot_json?.uncertainty?.baseline_stability_flags ?? null;
  const flags = currentFlags ?? historyFlags;

  return {
    ready: bundleExists && !!stateHistory,
    // Align with update_state: fast_ready is informational only.
    shouldRunSummary: true,
    stateReady: {
      fast_ready: !!flags?.fast_ready,
      slow_ready: !!flags?.slow_ready,
    },
  };
}

function resolvePythonBin(): string {
  const base = path.join(process.cwd(), 'python', 'coach');
  const candidates = [
    path.join(base, '.venv', 'Scripts', 'python.exe'),
    path.join(base, 'venv', 'Scripts', 'python.exe'),
    path.join(base, '.venv', 'bin', 'python3'),
    path.join(base, 'venv', 'bin', 'python3'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

async function updateStateHistoryActions(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  submissionLocalDate: string,
  result: any
) {
  const payload = {
    themes: result?.debug?.selected_domains ?? [],
    actions: result?.actions ?? [],
    questions: [],
  };

  const { error } = await supabaseAdmin
    .from('user_state_history2')
    .update({
      actions_generated_json: payload,
    })
    .eq('user_id', userId)
    .eq('date', submissionLocalDate);

  if (error) {
    throw new Error(`Failed to update user_state_history2 actions_generated_json: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth gate
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
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const body = await request.json().catch(() => ({}));
    const forDate: string | undefined = body.forDate;

    let targetDate = forDate;

    if (forDate && !/^\d{4}-\d{2}-\d{2}$/.test(forDate)) {
      return NextResponse.json({ error: 'forDate must be in YYYY-MM-DD format' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    await refreshFitbitProfileTimezoneForUser(supabaseAdmin, userId);
    const canonicalTimezone = await getCanonicalTimeZone(supabaseAdmin, userId);
    const todayLocalDate = formatLocalDate(new Date(), canonicalTimezone);
    if (!targetDate) {
      targetDate = todayLocalDate;
    }

    // Fetch overall_score
    let dailyOverall: { overall_score: number; date: string } | null = null;

    if (forDate) {
      const { data, error } = await supabaseAdmin
        .from('daily_overall')
        .select('overall_score, date')
        .eq('user_id', userId)
        .eq('date', forDate)
        .maybeSingle();
      if (error || !data) {
        return NextResponse.json(
          { error: `No overall_score found for ${forDate}. Please complete your daily check-in first.` },
          { status: 400 }
        );
      }
      dailyOverall = data;
      targetDate = forDate;
    } else {
      const { data: todayData } = await supabaseAdmin
        .from('daily_overall')
        .select('overall_score, date')
        .eq('user_id', userId)
        .eq('date', todayLocalDate)
        .maybeSingle();

      if (todayData) {
        dailyOverall = todayData;
        targetDate = todayData.date;
      } else {
        const { data: latestData } = await supabaseAdmin
          .from('daily_overall')
          .select('overall_score, date')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestData) {
          dailyOverall = latestData;
          targetDate = latestData.date;
        }
      }
    }

    if (!dailyOverall) {
      return NextResponse.json(
        { error: 'No overall_score found. Please complete a daily check-in first.' },
        { status: 400 }
      );
    }

    const submissionDate = targetDate!;
    const overallScore = dailyOverall.overall_score;

    let morningPreparation:
      | Awaited<ReturnType<typeof runMorningPreparationForSubmissionDate>>
      | {
          submissionLocalDate: string;
          processedLocalDate: string;
          timezone: string;
          nutrition: null;
          checkinRelations: null;
          journal: null;
          bundle: null;
          previousActionOutcomes: null;
          state: {
            shouldRunSummary: boolean;
            stateReady: { fast_ready: boolean; slow_ready: boolean };
          };
        };

    const existingPreparation = await getExistingPreparationStatus(
      supabaseAdmin,
      userId,
      submissionDate
    );

    if (existingPreparation.ready) {
      morningPreparation = {
        submissionLocalDate: submissionDate,
        processedLocalDate: shiftLocalDate(submissionDate, -1),
        timezone: canonicalTimezone,
        nutrition: null,
        checkinRelations: null,
        journal: null,
        bundle: null,
        previousActionOutcomes: null,
        state: {
          shouldRunSummary: existingPreparation.shouldRunSummary,
          stateReady: existingPreparation.stateReady,
        },
      };
    } else {
      morningPreparation = await runMorningPreparationForSubmissionDate({
        userId,
        submissionLocalDate: submissionDate,
        timezone: canonicalTimezone,
        supabaseAdmin,
      });
    }

    const readiness = await getCoachReadiness(supabaseAdmin, userId, submissionDate);

    if (!morningPreparation.state.shouldRunSummary) {
      console.warn('[coach/morning-run] blocked by readiness gate', {
        userId,
        forDate: submissionDate,
        readiness,
        stateReady: morningPreparation.state.stateReady,
      });
      return NextResponse.json({
        success: true,
        status: 'not_enough_history',
        forDate: submissionDate,
        processedDate: morningPreparation.processedLocalDate,
        message:
          'Not enough history yet to generate a morning coach summary. State was updated and the coach inputs are prepared.',
        readiness,
        debug: {
          fast_ready: morningPreparation.state.stateReady.fast_ready,
          slow_ready: morningPreparation.state.stateReady.slow_ready,
          processed_date: morningPreparation.processedLocalDate,
        },
      });
    }

    // Check for active goal
    const { data: existingGoal, error: goalError } = await supabaseAdmin
      .from('user_goals1')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (goalError || !existingGoal) {
      return NextResponse.json(
        { error: 'No active goal found. Please create a goal first.' },
        { status: 400 }
      );
    }

    // Delete any existing plan for this date (allow regeneration)
    await supabaseAdmin
      .from('daily_plans1')
      .delete()
      .eq('user_id', userId)
      .eq('for_date', submissionDate);

    // Create ingestion run
    const { data: ingestionRun, error: ingestionError } = await supabaseAdmin
      .from('ingestion_runs1')
        .insert({
          user_id: userId,
          for_date: submissionDate,
          status: 'success',
        pipeline_version: 'mvp-v1-langgraph',
      })
      .select()
      .single();

    if (ingestionError) throw ingestionError;

    await maybeSpawnBehaviorProfileRefresh(supabaseAdmin, userId);
    await maybeSpawnCorrelationArchetypeRefresh(supabaseAdmin, userId);

    const processedLocalDate = shiftLocalDate(submissionDate, -1);
    await syncCoachJournalContextForSubmissionDate(
      supabaseAdmin,
      userId,
      submissionDate,
      processedLocalDate
    );

    // Run Python pipeline
    const result = await runPythonPipeline(userId, submissionDate, overallScore, ingestionRun.ingestion_run_id);
    await updateStateHistoryActions(
      supabaseAdmin,
      userId,
      submissionDate,
      result
    );

    console.log('[coach/morning-run] plan generated', {
      userId,
      forDate: submissionDate,
      planId: result?.plan_id,
      fast_ready: readiness.fast_ready,
    });

    return NextResponse.json({
      success: true,
      status: 'ok',
      forDate: submissionDate,
      processedDate: morningPreparation.processedLocalDate,
      readiness,
      ...result,
    });
  } catch (error: any) {
    console.error('Morning run error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate morning plan' },
      { status: 500 }
    );
  }
}

function spawnBehaviorProfileRefresh(userId: string): void {
  const scriptPath = path.join(process.cwd(), 'python', 'coach', 'run_behavior_profile_update.py');
  const pythonBin = resolvePythonBin();
  const child = spawn(pythonBin, [scriptPath, userId, 'morning_submission'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function maybeSpawnBehaviorProfileRefresh(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<void> {
  try {
    const dueState = await getBehaviorProfileDueState(supabaseAdmin, userId);
    if (!dueState.due) {
      return;
    }

    const alreadyRunning = await hasRunningBehaviorProfileJob(supabaseAdmin, userId);
    if (alreadyRunning) {
      return;
    }

    spawnBehaviorProfileRefresh(userId);
    console.log('[coach/morning-run] spawned behavior profile refresh', {
      userId,
      reason: dueState.reason,
      featureDays: dueState.featureDays,
    });
  } catch (error) {
    console.error('[coach/morning-run] behavior profile refresh check failed', {
      userId,
      error,
    });
  }
}

function spawnCorrelationArchetypeRefresh(userId: string): void {
  const scriptPath = path.join(
    process.cwd(),
    'python',
    'coach',
    'run_correlation_archetype_update.py'
  );
  const pythonBin = resolvePythonBin();
  const child = spawn(pythonBin, [scriptPath, userId, 'morning_submission'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function maybeSpawnCorrelationArchetypeRefresh(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<void> {
  try {
    const dueState = await getCorrelationArchetypeDueState(supabaseAdmin, userId);
    if (!dueState.due) {
      return;
    }

    const alreadyRunning = await hasRunningCorrelationArchetypeJob(supabaseAdmin, userId);
    if (alreadyRunning) {
      return;
    }

    spawnCorrelationArchetypeRefresh(userId);
    console.log('[coach/morning-run] spawned correlation archetype refresh', {
      userId,
      reason: dueState.reason,
      featureDays: dueState.featureDays,
    });
  } catch (error) {
    console.error('[coach/morning-run] correlation archetype refresh check failed', {
      userId,
      error,
    });
  }
}

function runPythonPipeline(
  userId: string,
  forDate: string,
  overallScore: number,
  ingestionRunId: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'python', 'coach', 'run_pipeline.py');
    const pythonBin = resolvePythonBin();

    const python = spawn(pythonBin, [scriptPath, userId, forDate, overallScore.toString(), ingestionRunId]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => { stdout += data.toString(); });
    python.stderr.on('data', (data) => { stderr += data.toString(); });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python stderr:', stderr);
        console.error('Python stdout:', stdout);
        // Prefer stdout for error details (JSON errors go there), fall back to stderr
        const details = (stdout || stderr || '').trim();
        reject(new Error(details ? `Python process exited with code ${code}: ${details}` : `Python process exited with code ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      }
    });
  });
}
