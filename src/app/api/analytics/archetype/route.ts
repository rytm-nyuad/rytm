import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import {
  buildAnalyticsViz,
  enrichKeyCorrelations,
  type AnalyticsViz,
  type KeyCorrelation,
} from '@/lib/analytics/format';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  canForceCorrelationRefresh,
  formatCorrelationDueMessage,
  getCorrelationArchetypeDueState,
  getLatestCorrelationArchetypeJob,
  hasRunningCorrelationArchetypeJob,
} from '@/lib/coach/correlation-archetype';

export const dynamic = 'force-dynamic';

function asKeyCorrelations(raw: unknown): KeyCorrelation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is KeyCorrelation => !!item && typeof item === 'object');
}

function resolveViz(
  archetypeJson: Record<string, unknown> | null | undefined,
  correlations: KeyCorrelation[]
): AnalyticsViz {
  // Always rebuild from enriched correlations so every edge has a rho.
  // Stored viz is only a layout hint if present; numbers come from correlations.
  const built = buildAnalyticsViz(correlations);
  const stored = archetypeJson?.analytics_viz as AnalyticsViz | undefined;
  if (
    stored &&
    typeof stored === 'object' &&
    stored.network &&
    Array.isArray(stored.network.nodes) &&
    stored.network.nodes.length === built.network.nodes.length
  ) {
    // Prefer stored node positions when the node set matches; keep rebuilt edges/bars.
    const storedById = new Map(stored.network.nodes.map((n) => [n.id, n]));
    return {
      bars: built.bars,
      network: {
        nodes: built.network.nodes.map((n) => {
          const prev = storedById.get(n.id);
          return prev ? { ...n, x: prev.x, y: prev.y } : n;
        }),
        edges: built.network.edges,
      },
    };
  }
  return built;
}

export async function GET() {
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

    const supabaseAdmin = createSupabaseAdminClient();

    const [
      { data: archetype, error: archetypeError },
      { data: behaviorProfile },
      dueState,
      latestJob,
      alreadyRunning,
    ] = await Promise.all([
      supabase
        .from('user_correlation_archetypes1')
        .select(
          [
            'archetype_id',
            'status',
            'profile_version',
            'archetype_title',
            'summary',
            'core_insight',
            'strength',
            'archetype_json',
            'trusted_edges_json',
            'days_used',
            'created_at',
          ].join(', ')
        )
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('user_behavior_profiles1')
        .select('summary, primary_coaching_rule, created_at')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      getCorrelationArchetypeDueState(supabaseAdmin, user.id),
      getLatestCorrelationArchetypeJob(supabaseAdmin, user.id),
      hasRunningCorrelationArchetypeJob(supabaseAdmin, user.id),
    ]);

    if (archetypeError) {
      const message = archetypeError.message || '';
      if (
        message.includes('Could not find the table') ||
        message.includes('relation') ||
        archetypeError.code === 'PGRST205'
      ) {
        return NextResponse.json({
          archetype: null,
          behaviorProfile: behaviorProfile ?? null,
          unavailable: true,
          reason: 'schema_not_applied',
        });
      }
      throw new Error(archetypeError.message);
    }

    const refresh = {
      due: dueState.due,
      canRun: canForceCorrelationRefresh(dueState, { alreadyRunning }),
      reason: alreadyRunning ? 'already_running' : dueState.reason,
      message: formatCorrelationDueMessage(dueState, { alreadyRunning }),
      dueState,
      latestJob,
    };

    if (!archetype) {
      return NextResponse.json({
        archetype: null,
        behaviorProfile: behaviorProfile ?? null,
        unavailable: false,
        refresh,
      });
    }

    const archetypeJson =
      archetype.archetype_json && typeof archetype.archetype_json === 'object'
        ? (archetype.archetype_json as Record<string, unknown>)
        : null;

    const fromJson = asKeyCorrelations(archetypeJson?.key_correlations);
    const trustedEdges = asKeyCorrelations(archetype.trusted_edges_json);
    const keyCorrelations = enrichKeyCorrelations(
      fromJson.length ? fromJson : trustedEdges.slice(0, 6),
      trustedEdges
    );
    // Guarantee a numbered list even if key_correlations were incomplete.
    const displayCorrelations =
      keyCorrelations.length > 0
        ? keyCorrelations
        : enrichKeyCorrelations([], trustedEdges);
    const trustedEdgeCount = trustedEdges.length;

    const viz = resolveViz(archetypeJson, displayCorrelations);

    return NextResponse.json({
      archetype: {
        ...archetype,
        key_correlations: displayCorrelations,
        trusted_edge_count: trustedEdgeCount,
        viz,
      },
      behaviorProfile: behaviorProfile ?? null,
      unavailable: false,
      refresh,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to load analytics';
    console.error('[analytics/archetype]', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
