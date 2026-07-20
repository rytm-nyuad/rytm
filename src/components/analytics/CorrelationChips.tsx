'use client';

import {
  formatPairArrow,
  formatRhoScale,
  parseRho,
  rhoStroke,
  rhoColorClasses,
  type KeyCorrelation,
} from '@/lib/analytics/format';
import { SectionHeader } from '@/components/analytics/SectionHeader';

type Props = {
  correlations: KeyCorrelation[];
  compact?: boolean;
};

const SEGMENTS = 10;

export function CorrelationChips({ correlations, compact = false }: Props) {
  const rows = correlations.filter((c) => parseRho(c.rho) !== null);
  if (!rows.length) return null;

  return (
    <section className={compact ? 'space-y-4 h-full' : 'space-y-5'}>
      <SectionHeader title="Key connections" subtitle="Strength on a 0–1 scale" />

      <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
        {rows.map((c, idx) => {
          const rho = parseRho(c.rho)!;
          const colors = rhoColorClasses(rho);
          const filled = Math.round(Math.abs(rho) * SEGMENTS);
          const stroke = rhoStroke(rho);

          return (
            <div
              key={`${c.pair}-${c.feature_a}-${c.feature_b}-${idx}`}
              className={`rounded-xl dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200 ${
                compact ? 'px-3 py-3' : 'px-4 py-4'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-2.5">
                <p
                  className={`font-medium dark:text-white text-zinc-900 ${
                    compact ? 'text-[13px] leading-snug' : 'text-sm'
                  }`}
                >
                  {formatPairArrow(c.pair, c.feature_a, c.feature_b)}
                </p>
                <span
                  className={`text-[12px] font-semibold tabular-nums shrink-0 ${colors.text}`}
                >
                  {formatRhoScale(rho)}
                </span>
              </div>

              <div
                className="flex gap-[3px]"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={Math.abs(rho)}
                aria-label={`Correlation strength ${formatRhoScale(rho)}`}
              >
                {Array.from({ length: SEGMENTS }).map((_, i) => {
                  const on = i < filled;
                  return (
                    <div
                      key={i}
                      className={`h-2.5 flex-1 rounded-[3px] ${
                        on ? '' : 'dark:bg-zinc-800 bg-zinc-100'
                      }`}
                      style={
                        on
                          ? {
                              background: stroke,
                              opacity: 0.55 + (i / (SEGMENTS - 1)) * 0.45,
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
