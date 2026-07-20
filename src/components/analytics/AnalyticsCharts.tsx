'use client';

import { ANALYTICS_COLORS, rhoStroke, type AnalyticsViz } from '@/lib/analytics/format';
import { SectionHeader } from '@/components/analytics/SectionHeader';

type Props = {
  viz: AnalyticsViz | null | undefined;
};

const W = 480;
const H = 340;

function shortLabel(label: string): string {
  if (label.length <= 11) return label;
  const words = label.split(/\s+/);
  if (words.length >= 2) {
    return words.map((w) => (w.length <= 5 ? w : `${w.slice(0, 4)}.`)).join(' ');
  }
  return `${label.slice(0, 10)}…`;
}

function scaleNode(x: number, y: number) {
  return {
    x: 36 + (x / 320) * (W - 72),
    y: 28 + (y / 240) * (H - 56),
  };
}

function quadControl(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  bend: number
): { cx: number; cy: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return {
    cx: mx - (dy / len) * bend,
    cy: my + (dx / len) * bend,
  };
}

export function RelationshipNetwork({ viz }: Props) {
  const network = viz?.network;
  if (!network?.nodes?.length || !network.edges?.length) return null;

  const positioned = network.nodes.map((n) => ({
    ...n,
    ...scaleNode(n.x, n.y),
  }));
  const nodeById = new Map(positioned.map((n) => [n.id, n]));

  return (
    <section className="space-y-4 h-full">
      <SectionHeader
        title="Relationship network"
        subtitle="Signals that consistently move together"
      />

      <div className="relative overflow-hidden rounded-2xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 p-3 sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(ellipse at 50% 42%, rgba(91,33,182,0.10), transparent 58%)',
          }}
        />

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="relative w-full h-auto"
          role="img"
          aria-label="Correlation relationship network"
        >
          {network.edges.map((edge, idx) => {
            const source = nodeById.get(edge.source);
            const target = nodeById.get(edge.target);
            if (!source || !target) return null;

            const color = rhoStroke(edge.rho);
            const bend = 18 + (idx % 4) * 8;
            const { cx, cy } = quadControl(source.x, source.y, target.x, target.y, bend);
            const path = `M ${source.x} ${source.y} Q ${cx} ${cy} ${target.x} ${target.y}`;
            const strokeW = 2.2 + edge.abs_rho * 3.4;

            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeW + 4}
                  strokeLinecap="round"
                  opacity={0.12}
                />
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  opacity={0.88}
                />
              </g>
            );
          })}

          {positioned.map((node) => {
            const label = shortLabel(node.label);
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                <circle r={28} fill={ANALYTICS_COLORS.strongPos} opacity={0.08} />
                <circle r={22} className="dark:fill-zinc-800 fill-white" />
                <circle
                  r={22}
                  fill="none"
                  stroke={ANALYTICS_COLORS.modPos}
                  strokeOpacity={0.35}
                  strokeWidth={1.5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="dark:fill-zinc-100 fill-zinc-800"
                  style={{ fontSize: 10.5, fontWeight: 650 }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="relative mt-3 flex flex-wrap items-center justify-center gap-2">
          {(
            [
              ['Strong +', ANALYTICS_COLORS.strongPos],
              ['Moderate +', ANALYTICS_COLORS.modPos],
              ['Moderate −', ANALYTICS_COLORS.modNeg],
              ['Strong −', ANALYTICS_COLORS.strongNeg],
            ] as const
          ).map(([label, color]) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-200 text-zinc-600 border dark:border-zinc-700 border-zinc-200"
            >
              <span className="h-1.5 w-4 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
