/** Shared type for eval metric results. */
export interface EvalMetric {
  name: string;
  value: string | number;
  status: "good" | "warn" | "bad";
  note?: string;
}
