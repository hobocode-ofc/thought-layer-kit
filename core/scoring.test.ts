import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_GOAL, statusFromConfidence, gradeFromConfidence,
  aggregateConfidence, confidenceFromStatus, feedbackConfidence,
} from "./scoring";

describe("statusFromConfidence bands", () => {
  it("greens at or above the goal", () => {
    expect(statusFromConfidence(0.85)).toBe("green");
    expect(statusFromConfidence(0.99)).toBe("green");
  });
  it("yellows in the middle band", () => {
    expect(statusFromConfidence(0.6)).toBe("yellow");
    expect(statusFromConfidence(0.84)).toBe("yellow");
  });
  it("reds below 0.6", () => {
    expect(statusFromConfidence(0.59)).toBe("red");
    expect(statusFromConfidence(0)).toBe("red");
  });
  it("returns null for non-numbers", () => {
    expect(statusFromConfidence(null)).toBeNull();
    expect(statusFromConfidence(undefined)).toBeNull();
    expect(statusFromConfidence(NaN)).toBeNull();
  });
  it("uses 0.85 as the goal", () => {
    expect(CONFIDENCE_GOAL).toBe(0.85);
  });
});

describe("gradeFromConfidence", () => {
  it("maps to A/B/C/D/F by band", () => {
    expect(gradeFromConfidence(0.95)).toBe("A");
    expect(gradeFromConfidence(0.9)).toBe("A");
    expect(gradeFromConfidence(0.85)).toBe("B");
    expect(gradeFromConfidence(0.8)).toBe("B");
    expect(gradeFromConfidence(0.7)).toBe("C");
    expect(gradeFromConfidence(0.6)).toBe("D");
    expect(gradeFromConfidence(0.59)).toBe("F");
  });
  it("returns null for non-numbers", () => {
    expect(gradeFromConfidence(null)).toBeNull();
  });
});

describe("aggregateConfidence (panel mean)", () => {
  it("means the numeric values", () => {
    expect(aggregateConfidence([0.9, 0.6, 0.3])).toBeCloseTo(0.6, 10);
    expect(aggregateConfidence([0.8])).toBe(0.8);
  });
  it("ignores nulls and NaN", () => {
    expect(aggregateConfidence([0.8, null, undefined, NaN, 0.4])).toBeCloseTo(0.6, 10);
  });
  it("returns null when nothing is numeric", () => {
    expect(aggregateConfidence([null, undefined])).toBeNull();
    expect(aggregateConfidence([])).toBeNull();
  });
});

describe("confidenceFromStatus + feedbackConfidence (legacy)", () => {
  it("proxies a status to a coarse confidence", () => {
    expect(confidenceFromStatus("green")).toBe(0.9);
    expect(confidenceFromStatus("yellow")).toBe(0.7);
    expect(confidenceFromStatus("red")).toBe(0.4);
    expect(confidenceFromStatus("nope")).toBeNull();
  });
  it("prefers a numeric confidence on the feedback object", () => {
    expect(feedbackConfidence({ confidence: 0.72, status: "green" })).toBe(0.72);
  });
  it("falls back to legacy status when there is no number", () => {
    expect(feedbackConfidence({ status: "green" })).toBe(0.9);
    expect(feedbackConfidence({ status: "red" })).toBe(0.4);
  });
  it("returns null for empty feedback", () => {
    expect(feedbackConfidence(null)).toBeNull();
    expect(feedbackConfidence({})).toBeNull();
  });
});
