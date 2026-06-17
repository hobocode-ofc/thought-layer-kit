// Deterministic monthly projection engine. The AI proposes assumptions; all
// arithmetic happens here. Ported verbatim-in-behavior from the web app's
// src/lib/model.js (with explicit types).

export interface Party {
  id: string;
  name?: string;
  role?: string;
  startingCount?: number | string;
  monthlyNewBase?: number | string;
  monthlyNewGrowthPct?: number | string;
  monthlyChurnPct?: number | string;
  revenuePerUnitPerMonth?: number | string;
  variableCostPerUnitPerMonth?: number | string;
  cacPerUnit?: number | string;
  notes?: string;
}

export interface FixedCost {
  id: string;
  name?: string;
  monthlyAmount?: number | string;
  startMonth?: number | string;
  notes?: string;
}

export interface OneTimeCost {
  id: string;
  name?: string;
  amount?: number | string;
  month?: number | string;
  notes?: string;
}

export interface Assumptions {
  parties: Party[];
  fixedCosts?: FixedCost[];
  oneTimeCosts?: OneTimeCost[];
  horizonMonths?: number;
  currency?: string;
  narrative?: string;
}

export interface PartyRow {
  count: number;
  newUnits: number;
  churned: number;
  revenue: number;
  varCost: number;
  cac: number;
}

export interface ProjectionRow {
  month: number;
  parties: Record<string, PartyRow>;
  revenue: number;
  variableCost: number;
  cacSpend: number;
  fixedCost: number;
  oneTimeCost: number;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
  cumulative: number;
}

export interface ProjectionSummary {
  horizon: number;
  breakEvenMonth: number | null;
  cumBreakEvenMonth: number | null;
  year1Revenue: number;
  year1Net: number;
  totalRevenue: number;
  totalNet: number;
  maxDrawdown: number;
  endingMRR: number;
  endingCounts: Record<string, number>;
}

export interface Projection {
  rows: ProjectionRow[];
  summary: ProjectionSummary;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function computeProjection(assumptions: Assumptions | null | undefined): Projection | null {
  if (!assumptions?.parties?.length) return null;
  const horizon = Math.min(Math.max(assumptions.horizonMonths || 36, 6), 120);
  const parties = assumptions.parties;
  const fixedCosts = assumptions.fixedCosts || [];
  const oneTimeCosts = assumptions.oneTimeCosts || [];

  const counts: Record<string, number> = {};
  parties.forEach((p) => {
    counts[p.id] = num(p.startingCount);
  });

  const rows: ProjectionRow[] = [];
  let cumulative = 0;
  let breakEvenMonth: number | null = null;
  let cumBreakEvenMonth: number | null = null;

  for (let m = 1; m <= horizon; m++) {
    const row: ProjectionRow = {
      month: m, parties: {}, revenue: 0, variableCost: 0, cacSpend: 0, fixedCost: 0, oneTimeCost: 0,
      totalCost: 0, grossProfit: 0, netProfit: 0, cumulative: 0,
    };

    for (const p of parties) {
      const prev = counts[p.id] ?? 0;
      const newUnits = num(p.monthlyNewBase) * Math.pow(1 + num(p.monthlyNewGrowthPct) / 100, m - 1);
      const churned = prev * (num(p.monthlyChurnPct) / 100);
      const count = Math.max(0, prev + newUnits - churned);
      counts[p.id] = count;
      const revenue = count * num(p.revenuePerUnitPerMonth);
      const varCost = count * num(p.variableCostPerUnitPerMonth);
      const cac = newUnits * num(p.cacPerUnit);
      row.parties[p.id] = { count, newUnits, churned, revenue, varCost, cac };
      row.revenue += revenue;
      row.variableCost += varCost;
      row.cacSpend += cac;
    }

    for (const f of fixedCosts) {
      if (m >= num(f.startMonth, 1)) row.fixedCost += num(f.monthlyAmount);
    }
    for (const o of oneTimeCosts) {
      if (num(o.month, 1) === m) row.oneTimeCost += num(o.amount);
    }

    row.totalCost = row.variableCost + row.cacSpend + row.fixedCost + row.oneTimeCost;
    row.grossProfit = row.revenue - row.variableCost;
    row.netProfit = row.revenue - row.totalCost;
    cumulative += row.netProfit;
    row.cumulative = cumulative;

    if (breakEvenMonth === null && row.netProfit > 0) breakEvenMonth = m;
    if (cumBreakEvenMonth === null && cumulative > 0) cumBreakEvenMonth = m;
    rows.push(row);
  }

  const last = rows[rows.length - 1];
  if (!last) return null;
  const year1 = rows.slice(0, 12);
  return {
    rows,
    summary: {
      horizon,
      breakEvenMonth,
      cumBreakEvenMonth,
      year1Revenue: sum(year1.map((r) => r.revenue)),
      year1Net: sum(year1.map((r) => r.netProfit)),
      totalRevenue: sum(rows.map((r) => r.revenue)),
      totalNet: cumulative,
      maxDrawdown: Math.min(...rows.map((r) => r.cumulative), 0),
      endingMRR: last.revenue,
      endingCounts: Object.fromEntries(parties.map((p) => [p.id, last.parties[p.id]?.count || 0])),
    },
  };
}

export function fmtMoney(n: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString()}`;
  }
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

// Apply a benchmark suggestion path like "parties.rider.cacPerUnit" immutably.
export function applyBenchmarkPath(assumptions: Assumptions, path: string, value: number): Assumptions {
  const [group, id, field] = path.split(".");
  const next: Assumptions = structuredClone(assumptions);
  if (group === "parties" && id && field) {
    const p = next.parties.find((x) => x.id === id);
    if (p && field in p) (p as unknown as Record<string, unknown>)[field] = value;
  } else if (group === "fixedCosts" && id && field) {
    const f = (next.fixedCosts || []).find((x) => x.id === id);
    if (f) (f as unknown as Record<string, unknown>)[field] = value;
  } else if (group === "oneTimeCosts" && id && field) {
    const o = (next.oneTimeCosts || []).find((x) => x.id === id);
    if (o) (o as unknown as Record<string, unknown>)[field] = value;
  }
  return next;
}
