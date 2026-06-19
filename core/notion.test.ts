import { describe, it, expect } from "vitest";
import {
  markdownToBlocks, chunkRichText, chunkChildren, withinDepth,
  buildWikiPlan, artifactCategory, artifactRef, WIKI_AREAS, NOTION_FREE_FILE_LIMIT,
  type Block,
} from "./notion.ts";
import { buildArtifactSet } from "./artifacts.ts";
import { emptyState, type ProgressState } from "./progress.ts";

const fixture: ProgressState = {
  ...emptyState(),
  answers: { "what-statement": "A dispatch tool for HVAC crews.", "dq-build-vs-buy": "Build, the off-the-shelf options miss scheduling." },
  prd: { markdown: "# PRD\n\nThe product schedules crews.\n\n## Goals\n\n- Fast\n- Reliable", ts: 1 },
  grill: {
    requirements: [{ id: "R-1", category: "functional", text: "Schedule a crew." }],
    glossary: [{ term: "Crew", definition: "A team of technicians." }],
  },
  swot: { strengths: ["fast"], weaknesses: ["new"], opportunities: ["big market"], threats: ["incumbents"] },
  bizModel: { assumptions: { parties: [{ id: "crew", name: "Crew", role: "customer", startingCount: 10, monthlyNewBase: 5, monthlyNewGrowthPct: 3, monthlyChurnPct: 2, revenuePerUnitPerMonth: 40, cacPerUnit: 50 }], horizonMonths: 24, currency: "USD" } },
  research: { description: "TAM", brief: "The market is large.\n\nGrowing 20% a year." },
  brand: {
    guide: {
      brandName: "Acme Dispatch", tagline: "Scheduling made simple", positioning: "For HVAC contractors.",
      personality: ["direct"], voice: { tone: "plain", dos: ["be clear"], donts: ["jargon"] },
      palette: [{ name: "Primary", hex: "#1f3a5f", role: "brand" }],
      typography: { display: { family: "Fraunces" }, body: { family: "Inter" } },
      messaging: ["Schedule in one tap"],
    },
    logos: [{ id: "l1", svg: "<svg/>" }], chosenLogoId: "l1",
  },
};

describe("markdownToBlocks", () => {
  it("covers the supported block types", () => {
    const md = "# Title\n## Sub\nA paragraph with **bold** and `code`.\n- a bullet\n1. a number\n> a quote\n\n```\ncode line\n```\n---\n";
    const blocks = markdownToBlocks(md);
    const types = blocks.map((b) => b["type"]);
    expect(types).toContain("heading_1");
    expect(types).toContain("heading_2");
    expect(types).toContain("paragraph");
    expect(types).toContain("bulleted_list_item");
    expect(types).toContain("numbered_list_item");
    expect(types).toContain("quote");
    expect(types).toContain("code");
    expect(types).toContain("divider");
  });

  it("parses inline bold and code into annotated rich text", () => {
    const [para] = markdownToBlocks("plain **bold** `mono`");
    const rt = (para!["paragraph"] as { rich_text: Array<{ text: { content: string }; annotations?: { bold?: boolean; code?: boolean } }> }).rich_text;
    expect(rt.some((s) => s.annotations?.bold && s.text.content === "bold")).toBe(true);
    expect(rt.some((s) => s.annotations?.code && s.text.content === "mono")).toBe(true);
  });
});

describe("API-limit helpers", () => {
  it("chunkRichText splits content over 2000 chars", () => {
    const segs = chunkRichText("x".repeat(2500));
    expect(segs.length).toBe(2);
    expect(segs[0]!.text.content.length).toBe(2000);
    expect(segs[1]!.text.content.length).toBe(500);
    expect(chunkRichText("short").length).toBe(1);
  });

  it("chunkChildren batches at 100", () => {
    const blocks = Array.from({ length: 250 }, () => ({ type: "paragraph" } as Block));
    const batches = chunkChildren(blocks);
    expect(batches.map((b) => b.length)).toEqual([100, 100, 50]);
  });

  it("withinDepth flags trees deeper than 2 levels", () => {
    const flat: Block[] = [{ type: "paragraph", paragraph: {} }];
    expect(withinDepth(flat, 2)).toBe(true);
    const deep: Block[] = [{ type: "toggle", toggle: { children: [{ type: "toggle", toggle: { children: [{ type: "paragraph", paragraph: {} }] } }] } }];
    expect(withinDepth(deep, 2)).toBe(false);
  });
});

describe("artifact references", () => {
  it("categorizes by path", () => {
    expect(artifactCategory("Brand/Logo.svg")).toBe("Brand");
    expect(artifactCategory("Deploy/build.json")).toBe("Deploy");
    expect(artifactCategory("SWOT.svg")).toBe("Infographic");
    expect(artifactCategory("LandingPage/index.html")).toBe("Landing");
    expect(artifactCategory("PRD.md")).toBe("Doc");
  });

  it("links when a GitHub URL exists, else uploads small files", () => {
    expect(artifactRef(1000, true)).toBe("link");
    expect(artifactRef(1000, false)).toBe("upload");
    expect(artifactRef(NOTION_FREE_FILE_LIMIT + 1, false)).toBe("upload"); // no url, must try
  });
});

describe("buildWikiPlan", () => {
  it("creates a child page per populated area and an artifact index", () => {
    const { manifest } = buildArtifactSet(fixture, { generatedAt: "2026-06-18T00:00:00.000Z" });
    const urls: Record<string, string> = {};
    for (const f of manifest.files) urls[f.path] = `https://github.com/o/r/blob/main/artifacts/demo/${f.path}`;
    const plan = buildWikiPlan(fixture, { manifest, urls });

    expect(plan.title).toBe("Acme Dispatch workspace");
    const keys = plan.areas.map((a) => a.key);
    for (const k of ["big-idea", "business-model", "brand", "market-research", "strategy", "product", "decision-science"]) {
      expect(keys, `missing area ${k}`).toContain(k);
    }
    // library has no structured data -> no page.
    expect(keys).not.toContain("library");
    for (const a of plan.areas) {
      expect(a.blocks.length, `${a.key} empty`).toBeGreaterThan(0);
      expect(withinDepth(a.blocks, 2), `${a.key} too deep`).toBe(true);
    }
    // artifacts mapped from the manifest, with the GitHub links, sidecars filtered.
    expect(plan.artifacts.length).toBeGreaterThan(0);
    expect(plan.artifacts.every((a) => a.url)).toBe(true);
    expect(plan.artifacts.some((a) => a.path.startsWith("LandingPage/") && a.path !== "LandingPage/index.html")).toBe(false);
  });

  it("has all 8 areas defined and yields few areas for an empty state", () => {
    expect(WIKI_AREAS.length).toBe(8);
    const plan = buildWikiPlan(emptyState(), {});
    expect(plan.title).toBe("Your Product workspace");
    expect(plan.areas.length).toBe(0); // nothing captured yet
    expect(plan.artifacts.length).toBe(0);
  });
});
