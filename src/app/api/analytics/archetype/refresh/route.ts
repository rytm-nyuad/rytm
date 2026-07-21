import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  canForceCorrelationRefresh,
  formatCorrelationDueMessage,
  getCorrelationArchetypeDueState,
  getLatestCorrelationArchetypeJob,
  hasRunningCorrelationArchetypeJob,
} from '@/lib/coach/correlation-archetype';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function resolvePythonBin(): string {
  const base = path.join(process.cwd(), 'python', 'coach');
  const candidates = [
    path.join(base, '.venv', 'Scripts', 'python.exe'),
    path.join(base, 'venv', 'Scripts', 'python.exe'),
    path.join(base, '.venv', 'bin', 'python3'),
    path.join(base, 'venv', 'bin', 'python3'),
    path.join(base, '.venv', 'bin', 'python'),
    path.join(base, 'venv', 'bin', 'python'),
    'python3',
    'python',
  ];
  for (const candidate of candidates) {
    if (candidate === 'python3' || candidate === 'python') {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'python';
}

function spawnCorrelationArchetypeRefresh(userId: string): void {
  const scriptPath = path.join(
    process.cwd(),
    'python',
    'coach',
    'run_correlation_archetype_update.py'
  );
  const pythonBin = resolvePythonBin();
  // force: bypass refresh cadence / new-day gates; quality gates still apply.
  const child = spawn(pythonBin, [scriptPath, userId, 'force'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function getAuthedUserId(): Promise<string | null> {
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
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user.id;
}

export async function POST() {
  try {
    const userId = await getAuthedUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const dueState = await getCorrelationArchetypeDueState(supabaseAdmin, userId);

    // Analytics may re-run past cadence; only hard-block on insufficient features.
    if (dueState.reason === 'insufficient_feature_days') {
      return NextResponse.json(
        {
          status: 'blocked',
          reason: dueState.reason,
          message: formatCorrelationDueMessage(dueState),
          dueState,
        },
        { status: 409 }
      );
    }

    const alreadyRunning = await hasRunningCorrelationArchetypeJob(
      supabaseAdmin,
      userId
    );
    if (alreadyRunning) {
      const latestJob = await getLatestCorrelationArchetypeJob(supabaseAdmin, userId);
      return NextResponse.json(
        {
          status: 'blocked',
          reason: 'already_running',
          message: formatCorrelationDueMessage(dueState, { alreadyRunning: true }),
          dueState,
          latestJob,
        },
        { status: 409 }
      );
    }

    if (!canForceCorrelationRefresh(dueState)) {
      return NextResponse.json(
        {
          status: 'blocked',
          reason: dueState.reason,
          message: formatCorrelationDueMessage(dueState),
          dueState,
        },
        { status: 409 }
      );
    }

    spawnCorrelationArchetypeRefresh(userId);

    console.log('[analytics/archetype/refresh] spawned correlation archetype refresh', {
      userId,
      reason: dueState.reason,
      featureDays: dueState.featureDays,
      forced: true,
    });

    return NextResponse.json({
      status: 'started',
      message: 'Correlation pipeline started. This usually takes under a minute.',
      dueState,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to start correlation refresh';
    console.error('[analytics/archetype/refresh]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
