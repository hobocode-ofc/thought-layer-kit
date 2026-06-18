import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import extension from "../extensions/thought-layer.ts";

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
  it("loads its factory and registers the deterministic tools", () => {
    expect(Object.keys(tools).sort()).toEqual(["deploy", "tl_domains", "tl_project", "tl_scaffold", "tl_score", "tl_state", "tl_sync"]);
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

describe("tl_state tool (end to end against a temp file)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tl-tool-"));

  it("read on a fresh dir reports no file yet", async () => {
    const r = await tools.tl_state!.execute("t", { op: "read", path: dir });
    expect(r.details!.exists).toBe(false);
    expect(r.content[0]!.text).toContain("Start a fresh run");
  });

  it("records an answer, a passing panel verdict, and a PRD artifact, then resumes", async () => {
    await tools.tl_state!.execute("t", { op: "answer", path: dir, qId: "what-statement", value: "a dispatch tool for HVAC crews" });

    const fb = await tools.tl_state!.execute("t", {
      op: "feedback", path: dir, qId: "what-statement", mode: "panel", endState: "pass",
      personas: [
        { persona: "redteam", assessment: "narrow but clear", confidence: 0.86, suggestions: [{ summary: "name the wedge" }] },
        { persona: "expert", assessment: "sound", confidence: 0.88 },
        { persona: "investor", assessment: "fundable", confidence: 0.9 },
      ],
    });
    // mean 0.88 -> green, grade B, and a genuine pass is NOT overridden
    expect(fb.details!.status).toBe("green");
    expect(fb.details!.grade).toBe("B");

    // requirements with the kit's `statement` field get remapped to `text`
    await tools.tl_state!.execute("t", {
      op: "artifact", path: dir, artifact: "prd",
      value: { markdown: "# PRD", requirements: [{ id: "r1", category: "functional", statement: "must dispatch" }] },
    });

    const read = await tools.tl_state!.execute("t", { op: "read", path: dir });
    const state = read.details!.state as {
      answers: Record<string, string>;
      feedback: Record<string, { overridden: boolean; status: string }>;
      prd: { requirements: Array<{ text?: string; statement?: string }> };
    };
    expect(state.answers["what-statement"]).toContain("HVAC");
    expect(state.feedback["what-statement"]!.overridden).toBe(false); // pass, not set-aside
    expect(state.prd.requirements[0]!.text).toBe("must dispatch");
    expect(state.prd.requirements[0]!.statement).toBeUndefined();
    expect((read.details!.summary as { answered: number }).answered).toBe(1);
  });

  it("rejects an answer to a non-answerable qId via the tool error path", async () => {
    const r = await tools.tl_state!.execute("t", { op: "answer", path: dir, qId: "prd-grill", value: "nope" });
    expect(r.content[0]!.text).toMatch(/tl_state error|not an answerable/);
  });

  it("keeps several ideas as separate named files and lists them", async () => {
    const proj = mkdtempSync(join(tmpdir(), "tl-multi-"));
    await tools.tl_state!.execute("t", { op: "answer", path: join(proj, ".thought-layer", "acme.json"), qId: "what-statement", value: "dog grooming scheduler" });
    await tools.tl_state!.execute("t", { op: "answer", path: join(proj, ".thought-layer", "bravo.json"), qId: "what-statement", value: "HVAC dispatch" });
    const r = await tools.tl_state!.execute("t", { op: "list", path: proj });
    const files = (r.details!.files as Array<{ name: string }>).map((f) => f.name).sort();
    expect(files).toEqual(["acme.json", "bravo.json"]);
    expect(r.content[0]!.text).toContain("2 state file");
  });
});

describe("tl_scaffold tool (deterministic deployable site)", () => {
  const proj = mkdtempSync(join(tmpdir(), "tl-scaffold-"));
  const sp = join(proj, ".thought-layer", "state.json");
  const out = join(proj, "dist");

  it("writes a branded static site + a build.json manifest from the state file", async () => {
    await tools.tl_state!.execute("t", { op: "answer", path: sp, qId: "what-statement", value: "a dispatch tool for HVAC crews" });
    await tools.tl_state!.execute("t", { op: "answer", path: sp, qId: "pitch", value: "Schedule your whole crew in one tap." });
    await tools.tl_state!.execute("t", {
      op: "artifact", path: sp, artifact: "brand",
      value: { guide: { brandName: "Crewline", tagline: "Dispatch made simple", palette: [{ name: "Primary", hex: "#0a3d62" }], typography: { display: { family: "Fraunces" }, body: { family: "Inter" } } } },
    });

    const r = await tools.tl_scaffold!.execute("t", { path: sp, outDir: out, domain: "https://crewline.app", founder: "Jeremy" });
    expect(r.content[0]!.text).toContain("Crewline");

    const html = readFileSync(join(out, "index.html"), "utf8");
    expect(html).toContain("Crewline");
    expect(html).toContain("Schedule your whole crew");
    expect(html).toContain("--p:#0a3d62");
    expect(html).toContain("https://crewline.app/");
    expect(existsSync(join(out, "llms.txt"))).toBe(true);
    expect(existsSync(join(out, "robots.txt"))).toBe(true);
    expect(existsSync(join(out, "netlify.toml"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(proj, ".thought-layer", "build.json"), "utf8"));
    expect(manifest.producer).toBe("scaffold");
    expect(manifest.publishDir).toBe(out);
    expect(manifest.entry).toBe("index.html");
    expect(manifest.hasBackend).toBe(false);
  });
});
