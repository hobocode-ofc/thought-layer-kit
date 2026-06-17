// Confidence-driven scoring. The feedback loop's goal is a confidence above
// CONFIDENCE_GOAL; below that the loop keeps going (no round cap). All the
// band/grade thresholds live here so every consumer agrees on one source of
// truth. Ported verbatim-in-behavior from the web app's src/lib/scoring.js.

export type Status = "green" | "yellow" | "red";
export type Grade = "A" | "B" | "C" | "D" | "F";

export interface FeedbackLike {
  confidence?: number;
  status?: Status | string | null;
}

export const CONFIDENCE_GOAL = 0.85;

// confidence (0..1) -> stoplight status. null in, null out.
export function statusFromConfidence(c: number | null | undefined): Status | null {
  if (typeof c !== "number" || Number.isNaN(c)) return null;
  if (c >= CONFIDENCE_GOAL) return "green";
  if (c >= 0.6) return "yellow";
  return "red";
}

// confidence (0..1) -> letter grade. null when there is nothing to grade.
export function gradeFromConfidence(c: number | null | undefined): Grade | null {
  if (typeof c !== "number" || Number.isNaN(c)) return null;
  if (c >= 0.9) return "A";
  if (c >= 0.8) return "B";
  if (c >= 0.7) return "C";
  if (c >= 0.6) return "D";
  return "F";
}

// Mean of the numeric values, ignoring nulls/NaN. null when none are numeric.
// Used to aggregate the panel's three persona confidences into one number,
// and to aggregate a section's question confidences.
export function aggregateConfidence(values: Array<number | null | undefined>): number | null {
  const nums = (values || []).filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Coarse proxy confidence for a stoplight status, used for items that have a
// status but no numeric confidence, and for legacy feedback.
const STATUS_CONFIDENCE: Record<string, number> = { green: 0.9, yellow: 0.7, red: 0.4 };
export function confidenceFromStatus(status: string | null | undefined): number | null {
  if (status == null) return null;
  return STATUS_CONFIDENCE[status] ?? null;
}

// Pull the effective confidence off a feedback object.
export function feedbackConfidence(fb: FeedbackLike | null | undefined): number | null {
  if (!fb) return null;
  if (typeof fb.confidence === "number") return fb.confidence;
  return confidenceFromStatus(fb.status);
}
