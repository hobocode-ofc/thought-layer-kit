import { describe, it, expect, beforeAll } from "vitest";
import extension from "./thought-layer.ts";

// Load the Pi extension with a mock `pi` and capture what it registers. This
// verifies, with no model and no network, that the factory loads, all three
// deterministic tools register, and they return the exact expected outputs.
interface Tool {
  name: string;
  execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<{
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
}

const tools: Record<string, Tool> = {};

beforeAll(() => {
  // No domain key, so tl_domains takes the no-network registrar-link path.
  delete process.env.THOUGHT_LAYER_DOMAIN_KEY;
  delete process.env.RAPIDAPI_KEY;
  const pi = {
    registerTool: (spec: Tool) => { tools[spec.name] = spec; },
    registerCommand: () => {},
    on: () => {},
  };
  // The factory is typed against the Pi ExtensionAPI; the mock satisfies the
  // subset it uses.
  (extension as (pi: unknown) => void)(pi);
});

describe("thought-layer Pi extension", () => {
  it("loads its factory and registers the three deterministic tools", () => {
    expect(Object.keys(tools).sort()).toEqual(["tl_domains", "tl_project", "tl_score"]);
  });

  it("tl_score returns the exact band + grade", async () => {
    const r = await tools.tl_score!.execute("t", { confidences: [0.55, 0.8, 0.6] });
    expect(r.details!.confidence).toBeCloseTo(0.65, 10);
    expect(r.details!.status).toBe("yellow");
    expect(r.details!.grade).toBe("D");
    expect(r.content[0]!.text).toContain("65%");
  });

  it("tl_project returns the hand-checked projection summary", async () => {
    const r = await tools.tl_project!.execute("t", {
      parties: [{
        id: "u", startingCount: 0, monthlyNewBase: 10, monthlyNewGrowthPct: 0, monthlyChurnPct: 0,
        revenuePerUnitPerMonth: 5, variableCostPerUnitPerMonth: 1, cacPerUnit: 2,
      }],
      horizonMonths: 6,
    });
    const s = r.details!.summary as { year1Revenue: number; endingMRR: number; breakEvenMonth: number; maxDrawdown: number };
    expect(s.year1Revenue).toBe(1050);
    expect(s.endingMRR).toBe(300);
    expect(s.breakEvenMonth).toBe(1);
    expect(s.maxDrawdown).toBe(0);
  });

  it("tl_domains falls back to a registrar link with no key (no network)", async () => {
    const r = await tools.tl_domains!.execute("t", { slug: "acmedispatch" });
    expect(r.content[0]!.text).toContain("instantdomainsearch.com");
    expect(r.details!.hasKey).toBe(false);
  });
});
