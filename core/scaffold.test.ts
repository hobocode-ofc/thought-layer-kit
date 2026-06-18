import { describe, it, expect } from "vitest";
import { buildStarterSite, extractScaffoldSpec, scaffoldManifest, type StarterSiteSpec } from "./scaffold.ts";
import { emptyState } from "./progress.ts";

const spec: StarterSiteSpec = {
  brandName: "Acme Dispatch",
  tagline: "Scheduling made simple",
  pitch: "A dispatch tool that schedules HVAC crews in one tap.",
  positioning: "For independent HVAC contractors who hate spreadsheets.",
  personality: ["direct", "no-nonsense"],
  palette: { primary: "#1f3a5f", accent: "#e8743b", ink: "#16202b", surface: "#f7f8fa", muted: "#8a9099" },
  displayFont: "Fraunces",
  bodyFont: "Inter",
  voiceTone: "plain and practical",
  pricing: "$40/mo per crew",
};

describe("buildStarterSite", () => {
  it("emits a self-contained branded index.html + the SEO companion files", () => {
    const { files } = buildStarterSite(spec, { domain: "https://acme.com", founderName: "Jeremy" });
    expect(Object.keys(files).sort()).toEqual(["SEO.md", "_redirects", "index.html", "llms.txt", "netlify.toml", "robots.txt", "sitemap.xml"]);
    const html = files["index.html"]!;
    expect(html).toContain("Acme Dispatch");
    expect(html).toContain("Scheduling made simple");
    expect(html).toContain("--p:#1f3a5f"); // brand primary as a CSS var
    expect(html).toContain("--a:#e8743b");
    expect(html).toContain("family=Fraunces"); // display font in the Google Fonts URL
    expect(html).toContain('"@type":"Organization"'); // JSON-LD
    expect(html).toContain('"name":"Jeremy"'); // founder Person
    expect(html).toContain("https://acme.com/"); // canonical/domain
    expect(html).toContain('data-netlify="true"'); // Netlify Forms email capture
    expect(html).toContain("$40/mo per crew"); // pricing section
    expect(files["robots.txt"]).toContain("Sitemap: https://acme.com/sitemap.xml");
    expect(files["sitemap.xml"]).toContain("<loc>https://acme.com/</loc>");
    expect(files["SEO.md"]).toContain("og-image.png");
  });

  it("escapes user text and cannot break out of the JSON-LD script block", () => {
    const evil: StarterSiteSpec = { ...spec, brandName: "</script><script>alert(1)</script>", pitch: 'a & b "c"' };
    const html = buildStarterSite(evil).files["index.html"]!;
    expect(html).not.toContain("<script>alert(1)</script>"); // no raw breakout
    expect(html).toContain("&lt;"); // escaped in visible text
    expect(html).toContain("a &amp; b &quot;c&quot;");
    // the ld+json block escapes < and > as unicode, so the only real <script> tags
    // are the ld+json one plus nothing injected
    const scriptOpens = (html.match(/<script/g) || []).length;
    expect(scriptOpens).toBe(1); // only the ld+json script tag
  });

  it("is deterministic (same spec + opts -> identical output)", () => {
    const a = buildStarterSite(spec, { domain: "https://acme.com" }).files["index.html"];
    const b = buildStarterSite(spec, { domain: "https://acme.com" }).files["index.html"];
    expect(a).toBe(b);
  });

  it("works with no domain/founder (placeholder + no Person node)", () => {
    const html = buildStarterSite(spec).files["index.html"]!;
    expect(html).toContain("https://example.com/"); // placeholder domain
    expect(html).not.toContain('"@type":"Person"'); // no founder -> no Person node
  });
});

describe("extractScaffoldSpec", () => {
  it("maps a brand-bearing state", () => {
    const state = emptyState();
    state.answers = { pitch: "schedules HVAC crews", "pricing-model": "$40/mo" };
    state.brand = {
      guide: {
        brandName: "Acme", tagline: "tag", positioning: "for X",
        personality: ["bold"],
        palette: [{ name: "Primary", hex: "#111111" }, { name: "Accent", hex: "#ff0000" }],
        typography: { display: { family: "Fraunces" }, body: { family: "Inter" } },
        voice: { tone: "plain" },
      },
      logos: [{ id: "l1", svg: "<svg/>" }], chosenLogoId: "l1",
    };
    const s = extractScaffoldSpec(state);
    expect(s.brandName).toBe("Acme");
    expect(s.pitch).toBe("schedules HVAC crews");
    expect(s.pricing).toBe("$40/mo");
    expect(s.palette.primary).toBe("#111111");
    expect(s.palette.accent).toBe("#ff0000");
    expect(s.displayFont).toBe("Fraunces");
    expect(s.logoSvg).toBe("<svg/>");
  });

  it("degrades cleanly with no brand (a speedrun that skipped it)", () => {
    const state = emptyState();
    state.answers = { "what-statement": "a dispatch tool" };
    const s = extractScaffoldSpec(state);
    expect(s.brandName).toBe("Your Product");
    expect(s.pitch).toBe("a dispatch tool"); // falls back to what-statement
    expect(s.displayFont).toBe("Inter"); // default font
    expect(s.palette.primary).toBe("#1f3a5f"); // default palette
    expect(buildStarterSite(s).files["index.html"]).toContain("Your Product"); // still a valid site
  });
});

describe("scaffoldManifest", () => {
  it("is a scaffold-producer build manifest with publishDir + entry", () => {
    const m = scaffoldManifest("dist", "2026-06-17T00:00:00Z", { stateFile: ".thought-layer/state.json", prdTs: null, grillDone: false, fromSpeedrun: false });
    expect(m.producer).toBe("scaffold");
    expect(m.publishDir).toBe("dist");
    expect(m.entry).toBe("index.html");
    expect(m.hasBackend).toBe(false);
    expect(m.backend).toBeNull(); // a static scaffold never has a backend payload
    expect(m.stack).toBe("static");
    expect(m.kind).toBe("build");
    expect(m.seo.jsonLd).toBe(true);
  });
});
