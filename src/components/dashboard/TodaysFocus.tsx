"use client";

interface TodaysFocusProps {
  streak: number;
}

export function TodaysFocus({ streak }: TodaysFocusProps) {
  return (
    <div>
      <p>Let's build momentum</p>
      {streak === 0 && (
        <p className="mt-1 text-xs">Your streak begins now.</p>
      )}
    </div>
  );
}
