'use client';

type Props = {
  title: string;
  subtitle?: string;
};

/** Shared section header — matches coach page weight. */
export function SectionHeader({ title, subtitle }: Props) {
  return (
    <div className="space-y-1">
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight dark:text-zinc-100 text-zinc-900">
        {title}
      </h2>
      {subtitle ? (
        <p className="text-sm leading-snug dark:text-zinc-300 text-zinc-500">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
