import { describe, it, expect } from "vitest";
import { buildArtifactSet } from "./artifacts.ts";
import { computeProjection, fmtMoney, type Assumptions } from "./model.ts";
import { emptyState, type ProgressState } from "./progress.ts";

// The dash ban for generated markdown prose: no em-dash, en-dash, or spaced
// hyphen dashes (mirrors core/backend.test.ts). Hyphenated compounds and
// markdown bullets ("- item", "R-1") are fine.
const hasBannedDash = (s: string): boolean =>
  s.includes("—") || s.includes("–") || s.includes(" - ") || s.includes(" -- ");

const assumptions: Assumptions = {
  parties: [{
    id: "crew", name: "Crew", role: "customer", startingCount: 10,
    monthlyNewBase: 5, monthlyNewGrowthPct: 3, monthlyChurnPct: 2,
    revenuePerUnitPerMonth: 40, variableCostPerUnitPerMonth: 5, cacPerUnit: 50,
  }],
  fixedCosts: [{ id: "f1", name: "Hosting", monthlyAmount: 200, startMonth: 1 }],
  horizonMonths: 24,
  currency: "USD",
};

const fixture: ProgressState = {
  ...emptyState(),
  answers: { "what-statement": "A dispatch tool for HVAC crews." },
  feedback: { validation: { todos: [{ id: "t1", persona: "redteam", summary: "Talk to 5 contractors", patch: "" }] } },
  prd: { markdown: "# PRD\n\nThe product schedules crews in one tap.", ts: 1 },
  grill: {
    requirements: [
      { id: "R-1", category: "functional", text: "Users can schedule a crew." },
      { id: "R-2", category: "data", text: "Store crew availability." },
    ],
    glossary: [{ term: "Crew", definition: "A team of technicians." }],
  },
  swot: { strengths: ["fast onboarding"], weaknesses: ["new brand"], opportunities: ["large market"], threats: ["incumbents"] },
  bizModel: { assumptions },
  research: { description: "TAM analysis", brief: "The serviceable market is large." },
  brand: {
    guide: {
      brandName: "Acme Dispatch",
      tagline: "Scheduling made simple",
      positioning: "For independent HVAC contractors.",
      personality: ["direct", "practical"],
      voice: { tone: "plain and practical", dos: ["be clear"], donts: ["use jargon"] },
      palette: [
        { name: "Primary", hex: "#1f3a5f", role: "brand" },
        { name: "Accent", hex: "#e8743b", role: "cta" },
      ],
      typography: { display: { family: "Fraunces", weights: "700", usage: "headlines" }, body: { family: "Inter", weights: "400", usage: "body" } },
      logoDirection: "wordmark",
      imagery: "clean field photos",
      messaging: ["Schedule in one tap", "No spreadsheets"],
    },
    logos: [{ id: "l1", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>' }],
    chosenLogoId: "l1",
  },
};

describe("buildArtifactSet", () => {
  it("emits the full deliverable bundle gated on present state", () => {
    const { files, manifest } = buildArtifactSet(fixture, { generatedAt: "2026-06-18T00:00:00.000Z", domain: "https://acme.com" });
    const names = Object.keys(files);
    for (const expected of [
      "PRD.md", "Requirements.md", "DomainGlossary.md", "BuildPrompt.md",
      "SWOT.md", "SWOT.svg", "BusinessModel.svg", "MarketResearch.md",
      "Brand/BrandStyleGuide.md", "Brand/Logo.svg", "Brand/LookBook.html",
      "LandingPage/index.html", "README.md",
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }

    expect(manifest.brandName).toBe("Acme Dispatch");
    expect(manifest.files.length).toBe(names.length);
    expect(manifest.kind).toBe("artifacts");

    expect(files["Requirements.md"]).toContain("R-1");
    expect(files["Requirements.md"]).toContain("## Functional");
    expect(files["DomainGlossary.md"]).toContain("Crew");
    expect(files["SWOT.svg"]).toContain("STRENGTHS");
    expect(files["Brand/LookBook.html"]).toContain("Acme Dispatch");
    expect(files["Brand/LookBook.html"]).toContain("#1f3a5f");
    expect(files["README.md"]).toContain("PRD.md");
    expect(files["BuildPrompt.md"]).toContain("Talk to 5 contractors"); // carried-forward to-do
  });

  it("renders the business model infographic with the projection's exact numbers", () => {
    const { files } = buildArtifactSet(fixture, { generatedAt: "2026-06-18T00:00:00.000Z" });
    const proj = computeProjection(assumptions)!;
    expect(files["BusinessModel.svg"]).toContain("BUSINESS MODEL");
    expect(files["BusinessModel.svg"]).toContain(fmtMoney(proj.summary.year1Revenue, "USD"));
  });

  it("keeps every generated markdown file dash-free (the copy rule)", () => {
    const { files } = buildArtifactSet(fixture, { generatedAt: "2026-06-18T00:00:00.000Z" });
    for (const [path, content] of Object.entries(files)) {
      // Only the markdown artifacts.ts itself authors; LandingPage/* is
      // scaffold.ts's domain (its SEO.md predates and is exempt from this rule).
      if (!path.endsWith(".md") || path.startsWith("LandingPage/")) continue;
      expect(hasBannedDash(content), `${path} has a banned dash`).toBe(false);
    }
  });

  it("still synthesizes the landing page and README from an empty state", () => {
    const { files, manifest } = buildArtifactSet(emptyState(), { generatedAt: "2026-06-18T00:00:00.000Z" });
    expect(Object.keys(files)).toContain("LandingPage/index.html");
    expect(Object.keys(files)).toContain("README.md");
    expect(manifest.brandName).toBe("Your Product");
    // No brand/prd/grill/swot present, so those artifacts are absent.
    expect(Object.keys(files)).not.toContain("Brand/BrandStyleGuide.md");
    expect(Object.keys(files)).not.toContain("SWOT.svg");
  });
});
