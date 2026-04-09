import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

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

    const today = new Date().toISOString().split('T')[0];
    let targetDate = forDate || today;

    if (forDate && !/^\d{4}-\d{2}-\d{2}$/.test(forDate)) {
      return NextResponse.json({ error: 'forDate must be in YYYY-MM-DD format' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();

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
        .eq('date', today)
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

    const overallScore = dailyOverall.overall_score;

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
      .eq('for_date', targetDate);

    // Create ingestion run
    const { data: ingestionRun, error: ingestionError } = await supabaseAdmin
      .from('ingestion_runs1')
      .insert({
        user_id: userId,
        for_date: targetDate,
        status: 'success',
        pipeline_version: 'mvp-v1-langgraph',
      })
      .select()
      .single();

    if (ingestionError) throw ingestionError;

    // Run Python pipeline
    const result = await runPythonPipeline(userId, targetDate, overallScore, ingestionRun.ingestion_run_id);

    return NextResponse.json({ success: true, forDate: targetDate, ...result });
  } catch (error: any) {
    console.error('Morning run error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate morning plan' },
      { status: 500 }
    );
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
    const venvPython = path.join(process.cwd(), 'python', 'coach', 'venv', 'bin', 'python3');
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';

    const python = spawn(pythonBin, [scriptPath, userId, forDate, overallScore.toString(), ingestionRunId]);

    let stdout = '';
    let stderr = '';

    python.stdout.on('data', (data) => { stdout += data.toString(); });
    python.stderr.on('data', (data) => { stderr += data.toString(); });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python stderr:', stderr);
        const details = (stderr || stdout || '').trim();
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
