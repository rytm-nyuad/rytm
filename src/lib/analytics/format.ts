/**
 * Formatting + presentation helpers for Analytics.
 */

export type KeyCorrelation = {
  pair?: string;
  feature_a?: string;
  feature_b?: string;
  rho?: number | null;
  vs_typical?: string | null;
  note?: string;
  n_pairs?: number | null;
};

export const FEATURE_LABELS: Record<string, string> = {
  overall_score: 'Overall Score',
  readiness_score: 'Readiness',
  sleep_duration_hours: 'Sleep Duration',
  sleep_efficiency: 'Sleep Efficiency',
  hrv_rmssd: 'HRV',
  total_active_minutes: 'Active Minutes',
  sedentary_minutes: 'Sedentary Time',
  social_connectedness: 'Social Connectedness',
  mood: 'Mood',
  stress: 'Stress',
  energy: 'Energy',
  focus: 'Focus',
  caffeine_cups: 'Caffeine',
  negative_emotion_ratio: 'Negative Emotions',
};

function titleCaseWords(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      if (word.toUpperCase() === 'HRV') return 'HRV';
      if (word.toUpperCase() === word && word.length <= 4) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

export function formatFeatureLabel(raw: string): string {
  const key = raw.trim();
  if (FEATURE_LABELS[key]) return FEATURE_LABELS[key];
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return titleCaseWords(spaced);
}

export function splitPair(pair?: string, featureA?: string, featureB?: string): [string, string] {
  if (featureA && featureB) return [featureA, featureB];
  if (!pair) return ['signal', 'signal'];
  const parts = pair
    .split(/\s*(?:↔|←→|→|<-|->|[–—\-|])\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts[1]];
  return [pair, pair];
}

export function formatPairArrow(pair?: string, featureA?: string, featureB?: string): string {
  const [a, b] = splitPair(pair, featureA, featureB);
  return `${formatFeatureLabel(a)} ↔ ${formatFeatureLabel(b)}`;
}

export function formatRho(rho: number): string {
  const sign = rho > 0 ? '+' : '';
  return `${sign}${rho.toFixed(2)}`;
}

/** Display rho on a fixed 0–1 strength scale, e.g. +0.50/1 or -0.49/1. */
export function formatRhoScale(rho: number): string {
  const sign = rho > 0 ? '+' : rho < 0 ? '-' : '';
  const magnitude = Math.min(1, Math.abs(rho)).toFixed(2);
  return `${sign}${magnitude}/1`;
}

/** Coerce JSON/string/number rho values into a finite number. */
export function parseRho(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_\-–—|/]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Map human labels back to canonical feature keys when possible. */
const LABEL_TO_FEATURE: Record<string, string> = Object.fromEntries(
  Object.entries(FEATURE_LABELS).flatMap(([key, label]) => [
    [normalizeToken(key), key],
    [normalizeToken(label), key],
  ])
);

// Common LLM / display aliases
Object.assign(LABEL_TO_FEATURE, {
  sleep: 'sleep_duration_hours',
  sleepduration: 'sleep_duration_hours',
  sleepquality: 'sleep_efficiency',
  efficiency: 'sleep_efficiency',
  readiness: 'readiness_score',
  overall: 'overall_score',
  overallscore: 'overall_score',
  activeminutes: 'total_active_minutes',
  activity: 'total_active_minutes',
  sedentary: 'sedentary_minutes',
  sedentarytime: 'sedentary_minutes',
  social: 'social_connectedness',
  socialconnection: 'social_connectedness',
  socialconnectedness: 'social_connectedness',
  hrv: 'hrv_rmssd',
  caffeine: 'caffeine_cups',
  negativeemotions: 'negative_emotion_ratio',
  negativeemotion: 'negative_emotion_ratio',
});

function canonicalFeature(raw?: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (FEATURE_LABELS[trimmed]) return trimmed;
  return LABEL_TO_FEATURE[normalizeToken(trimmed)] || trimmed;
}

function pairLookupKey(pair?: string, featureA?: string, featureB?: string): string {
  const [a, b] = splitPair(pair, featureA, featureB);
  return [canonicalFeature(a), canonicalFeature(b)]
    .map(normalizeToken)
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * Ensure every key correlation has a numeric rho, filling from trusted edges when needed.
 * Falls back to the strongest trusted edges if key_correlations cannot be matched.
 */
export function enrichKeyCorrelations(
  correlations: KeyCorrelation[],
  trustedEdges: KeyCorrelation[] = []
): KeyCorrelation[] {
  const byPair = new Map<string, number>();
  for (const edge of trustedEdges) {
    const rho = parseRho(edge.rho);
    if (rho === null) continue;
    const key = pairLookupKey(edge.pair, edge.feature_a, edge.feature_b);
    if (key) byPair.set(key, rho);
  }

  const enriched = correlations
    .map((c) => {
      const [rawA, rawB] = splitPair(c.pair, c.feature_a, c.feature_b);
      const feature_a = canonicalFeature(rawA) || rawA;
      const feature_b = canonicalFeature(rawB) || rawB;
      const existing = parseRho(c.rho);
      const filled =
        existing ?? byPair.get(pairLookupKey(c.pair, feature_a, feature_b)) ?? null;
      return {
        ...c,
        feature_a,
        feature_b,
        pair: c.pair || `${feature_a}–${feature_b}`,
        rho: filled,
      };
    })
    .filter((c) => parseRho(c.rho) !== null) as KeyCorrelation[];

  if (enriched.length > 0) return enriched;

  // Last resort: show top trusted edges so the UI always has numbers.
  const fallback: KeyCorrelation[] = [];
  for (const edge of trustedEdges) {
    const rho = parseRho(edge.rho);
    if (rho === null) continue;
    const [rawA, rawB] = splitPair(edge.pair, edge.feature_a, edge.feature_b);
    const feature_a = canonicalFeature(rawA) || rawA;
    const feature_b = canonicalFeature(rawB) || rawB;
    fallback.push({
      ...edge,
      feature_a,
      feature_b,
      pair: edge.pair || `${feature_a}–${feature_b}`,
      rho,
    });
  }
  return fallback
    .sort((a, b) => Math.abs(Number(b.rho)) - Math.abs(Number(a.rho)))
    .slice(0, 6);
}

/**
 * Graph / correlation colors — darker blue & purple; rose for negatives (no pink).
 */
export const ANALYTICS_COLORS = {
  strongPos: '#5b21b6', // deep violet
  strongPosDeep: '#4c1d95',
  strongPosSoft: '#7c3aed',
  modPos: '#1e40af', // deep blue
  modPosDeep: '#1e3a8a',
  modPosSoft: '#2563eb',
  modNeg: '#b91c1c', // deep red (no pink)
  modNegDeep: '#991b1b',
  modNegSoft: '#dc2626',
  strongNeg: '#9f1239', // deep rose-red
  strongNegDeep: '#881337',
  strongNegSoft: '#be123c',
  neutral: '#71717a',
  neutralDeep: '#52525b',
} as const;

export function rhoStroke(rho: number): string {
  if (rho >= 0.6) return ANALYTICS_COLORS.strongPos;
  if (rho >= 0.4) return ANALYTICS_COLORS.modPos;
  if (rho <= -0.6) return ANALYTICS_COLORS.strongNeg;
  if (rho <= -0.4) return ANALYTICS_COLORS.modNeg;
  return ANALYTICS_COLORS.neutral;
}

export function rhoBarGradient(rho: number): string {
  if (rho >= 0.6) {
    return `linear-gradient(90deg, ${ANALYTICS_COLORS.strongPosDeep}, ${ANALYTICS_COLORS.strongPosSoft})`;
  }
  if (rho >= 0.4) {
    return `linear-gradient(90deg, ${ANALYTICS_COLORS.modPosDeep}, ${ANALYTICS_COLORS.modPosSoft})`;
  }
  if (rho <= -0.6) {
    return `linear-gradient(90deg, ${ANALYTICS_COLORS.strongNegDeep}, ${ANALYTICS_COLORS.strongNegSoft})`;
  }
  if (rho <= -0.4) {
    return `linear-gradient(90deg, ${ANALYTICS_COLORS.modNegDeep}, ${ANALYTICS_COLORS.modNegSoft})`;
  }
  return `linear-gradient(90deg, ${ANALYTICS_COLORS.neutralDeep}, ${ANALYTICS_COLORS.neutral})`;
}

/** Subtle color system for correlation strength / direction. */
export function rhoColorClasses(rho: number): {
  text: string;
  bar: string;
  softBg: string;
} {
  if (rho >= 0.6) {
    return {
      text: 'text-violet-700 dark:text-violet-200',
      bar: 'bg-violet-600',
      softBg: 'bg-violet-500/10',
    };
  }
  if (rho >= 0.4) {
    return {
      text: 'text-indigo-700 dark:text-indigo-200',
      bar: 'bg-indigo-600',
      softBg: 'bg-indigo-500/10',
    };
  }
  if (rho <= -0.6) {
    return {
      text: 'text-rose-700 dark:text-rose-200',
      bar: 'bg-rose-700',
      softBg: 'bg-rose-500/10',
    };
  }
  if (rho <= -0.4) {
    return {
      text: 'text-red-700 dark:text-red-200',
      bar: 'bg-red-600',
      softBg: 'bg-red-500/10',
    };
  }
  return {
    text: 'text-zinc-600 dark:text-zinc-200',
    bar: 'bg-zinc-400',
    softBg: 'bg-zinc-500/10',
  };
}

/** Soft rewrite of research-voice copy into second person for display. */
export function toSecondPerson(text: string): string {
  if (!text) return text;
  return text
    .replace(/\bThis user exhibits\b/gi, 'You tend to show')
    .replace(/\bThis user is particularly distinctive in\b/gi, 'What stands out is')
    .replace(/\bThis user stands out with\b/gi, 'You stand out with')
    .replace(/\bThis user\b/g, 'You')
    .replace(/\bthis user\b/g, 'you')
    .replace(/\bTheir\b/g, 'Your')
    .replace(/\btheir\b/g, 'your')
    .replace(/\bThey are\b/g, 'You are')
    .replace(/\bthey are\b/g, 'you are')
    .replace(/\bThey\b/g, 'You')
    .replace(/\bThe user's\b/gi, 'Your')
    .replace(/\bthe user's\b/gi, 'your')
    .replace(/\bThis profile is highly optimizable\b/gi, 'This profile is highly optimizable for you')
    .trim();
}

export function confidenceFromArchetype(input: {
  daysUsed?: number | null;
  trustedEdgeCount?: number | null;
}): { label: 'High' | 'Medium' | 'Building'; tone: string } {
  const days = input.daysUsed ?? 0;
  const edges = input.trustedEdgeCount ?? 0;
  if (days >= 28 && edges >= 5) {
    return { label: 'High', tone: 'text-emerald-700 dark:text-emerald-200' };
  }
  if (days >= 15 && edges >= 3) {
    return { label: 'Medium', tone: 'text-indigo-700 dark:text-indigo-200' };
  }
  return { label: 'Building', tone: 'text-violet-700 dark:text-violet-200' };
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'Recently';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Recently';
  const days = Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 45) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type AnalyticsViz = {
  bars: Array<{
    id: string;
    label: string;
    feature_a: string;
    feature_b: string;
    rho: number;
    abs_rho: number;
  }>;
  network: {
    nodes: Array<{ id: string; label: string; x: number; y: number }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      rho: number;
      abs_rho: number;
    }>;
  };
};

/** Deterministic viz payload from key correlations (cheap; also storeable). */
export function buildAnalyticsViz(correlations: KeyCorrelation[], limit = 6): AnalyticsViz {
  const top = correlations
    .map((c) => {
      const rho = parseRho(c.rho);
      if (rho === null) return null;
      const [a, b] = splitPair(c.pair, c.feature_a, c.feature_b);
      return {
        id: `${a}|${b}`,
        label: `${formatFeatureLabel(a)} → ${formatFeatureLabel(b)}`,
        feature_a: a,
        feature_b: b,
        rho,
        abs_rho: Math.abs(rho),
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((x, y) => y.abs_rho - x.abs_rho)
    .slice(0, limit);

  const nodeIds = Array.from(
    new Set(top.flatMap((e) => [e.feature_a, e.feature_b]))
  );
  const cx = 160;
  const cy = 120;
  const radius = Math.min(95, 40 + nodeIds.length * 8);
  const nodes = nodeIds.map((id, i) => {
    const angle = (-Math.PI / 2) + (i * (2 * Math.PI)) / Math.max(nodeIds.length, 1);
    return {
      id,
      label: formatFeatureLabel(id),
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });

  return {
    bars: top,
    network: {
      nodes,
      edges: top.map((e) => ({
        id: e.id,
        source: e.feature_a,
        target: e.feature_b,
        rho: e.rho,
        abs_rho: e.abs_rho,
      })),
    },
  };
}
