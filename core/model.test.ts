import { describe, it, expect } from "vitest";
import { computeProjection, fmtMoney, fmtNum, applyBenchmarkPath, type Assumptions } from "./model";

// A hand-computable scenario: one party, +10 units/month, no growth, no churn,
// $5 revenue, $1 variable cost, $2 CAC per new unit, 6-month horizon, no fixed
// or one-time costs. Every figure below was worked out by hand.
const SIMPLE: Assumptions = {
  parties: [{
    id: "u", startingCount: 0, monthlyNewBase: 10, monthlyNewGrowthPct: 0, monthlyChurnPct: 0,
    revenuePerUnitPerMonth: 5, variableCostPerUnitPerMonth: 1, cacPerUnit: 2,
  }],
  horizonMonths: 6,
};

describe("computeProjection", () => {
  it("returns null with no parties", () => {
    expect(computeProjection(null)).toBeNull();
    expect(computeProjection({ parties: [] })).toBeNull();
  });

  it("computes the hand-checked scenario exactly", () => {
    const p = computeProjection(SIMPLE)!;
    expect(p.rows.length).toBe(6);

    // month 1: count 10, revenue 50, totalCost 30 (10 var + 20 cac), net 20
    expect(p.rows[0]!.parties.u!.count).toBe(10);
    expect(p.rows[0]!.revenue).toBe(50);
    expect(p.rows[0]!.totalCost).toBe(30);
    expect(p.rows[0]!.netProfit).toBe(20);

    // month 6: count 60, revenue 300, net 220, cumulative 720
    expect(p.rows[5]!.parties.u!.count).toBe(60);
    expect(p.rows[5]!.revenue).toBe(300);
    expect(p.rows[5]!.netProfit).toBe(220);
    expect(p.rows[5]!.cumulative).toBe(720);

    const s = p.summary;
    expect(s.horizon).toBe(6);
    expect(s.breakEvenMonth).toBe(1);
    expect(s.cumBreakEvenMonth).toBe(1);
    expect(s.year1Revenue).toBe(1050);
    expect(s.year1Net).toBe(720);
    expect(s.totalRevenue).toBe(1050);
    expect(s.totalNet).toBe(720);
    expect(s.maxDrawdown).toBe(0);
    expect(s.endingMRR).toBe(300);
    expect(s.endingCounts).toEqual({ u: 60 });
  });

  it("clamps the horizon to [6, 120]", () => {
    expect(computeProjection({ parties: [{ id: "u" }], horizonMonths: 2 })!.summary.horizon).toBe(6);
    expect(computeProjection({ parties: [{ id: "u" }], horizonMonths: 999 })!.summary.horizon).toBe(120);
  });

  it("coerces missing/garbled numbers to 0 (no NaN leakage)", () => {
    const p = computeProjection({ parties: [{ id: "u", startingCount: undefined, revenuePerUnitPerMonth: "abc" as unknown as number }] })!;
    expect(Number.isNaN(p.summary.totalRevenue)).toBe(false);
    expect(p.summary.totalRevenue).toBe(0);
  });
});

describe("formatters + applyBenchmarkPath", () => {
  it("formats money and numbers", () => {
    expect(fmtMoney(1234)).toBe("$1,234");
    expect(fmtNum(1234.6)).toBe("1,235");
  });
  it("applies a benchmark path immutably", () => {
    const next = applyBenchmarkPath(SIMPLE, "parties.u.cacPerUnit", 99);
    expect(next.parties[0]!.cacPerUnit).toBe(99);
    expect(SIMPLE.parties[0]!.cacPerUnit).toBe(2); // original untouched
  });
});
