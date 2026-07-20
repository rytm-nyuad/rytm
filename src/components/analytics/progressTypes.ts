export type ProgressPoint = {
  date: string;
  energy: number | null;
  focus: number | null;
  productivity: number | null;
  mood: number | null;
  stress: number | null;
  overall: number | null;
};

export type ProgressMetric = {
  key: keyof Omit<ProgressPoint, 'date'>;
  label: string;
  color: string;
  colorDark?: string;
};
