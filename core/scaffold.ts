// Deterministic, no-LLM starter-site generator: structured spec + brand -> a
// self-contained, branded, SEO-complete static site. This is the guaranteed
// "instantly-deployable floor" so even a thin or failed model-build still
// yields a real, ownable site. The build skill drives the agent to build the
// PRODUCT; this tool guarantees a deployable landing page from the same spec.
//
// Technique ported from the web app's brandLookbookHtml/brandTokens
// (src/lib/exports.js): esc() HTML escaping, the color-role regex with
// fallbacks, the fam() Google-Fonts URL builder, inline CSS via :root brand
// vars. CDATA is needed only inside SVG <style>; HTML <style> does not need it,
// so this emits plain HTML. Pure: no fs, no Date - the caller supplies builtAt.

import type { ProgressState } from "./progress.ts";
import type { BackendMeta } from "./backend.ts";

export interface StarterSiteSpec {
  brandName: string;
  tagline: string;
  pitch: string;
  positioning: string;
  personality: string[];
  palette: { primary: string; accent: string; ink: string; surface: string; muted: string };
  displayFont: string;
  bodyFont: string;
  voiceTone: string;
  logoSvg?: string;
  pricing?: string;
}

export interface ScaffoldOptions {
  domain?: string;
  founderName?: string;
  socialImage?: string;
}

// The shared build manifest the deploy step consumes. Both producers (this
// scaffold tool and the build skill's agent) write the same shape.
export interface BuildManifest {
  app: "thought-layer";
  kind: "build";
  version: 1;
  builtAt: string;
  producer: "agent" | "scaffold";
  publishDir: string;
  entry: string;
  stack: string;
  hasBackend: boolean;
  backendNote: string | null;
  // The structured backend payload, present only when the build emitted a real
  // backend (hasBackend true). Optional + nullable so existing static build.json
  // files round-trip and the deploy reader tolerates its absence. The deploy
  // automation follow-up consumes it; today only deploy messaging reads it.
  backend?: BackendMeta | null;
  buildCommand: string | null;
  installCommand: string | null;
  nodeVersion: string;
  provenance: { stateFile: string; prdTs: number | null; grillDone: boolean; fromSpeedrun: boolean };
  requirements: { total: number; built: number; deferred: number; deferredIds: string[] };
  seo: Record<string, boolean>;
  artifacts: { traceability: string | null; decisions: string | null; seo: string | null };
  verified: { buildRan: boolean; publishDirExists: boolean; entryLoads: boolean; notes: string };
}

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fam = (f: string): string => f.trim().replace(/\s+/g, "+");

// ---- extract a spec from the portable state file -----------------------------

export function extractScaffoldSpec(state: ProgressState): StarterSiteSpec {
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const str = (v: unknown): string => (typeof v === "string" ? v : "");

  const brand = obj(state.brand);
  const guide = obj(brand["guide"]);
  const answers = state.answers || {};

  const palette = Array.isArray(guide["palette"])
    ? (guide["palette"] as Array<{ name?: string; hex?: string }>)
    : [];
  const role = (re: string, fb: string): string => {
    const m = palette.find((p) => p?.name && new RegExp(re, "i").test(p.name));
    return m?.hex || fb;
  };
  const typography = obj(guide["typography"]);
  const fontOf = (slot: unknown, fb: string): string => str(obj(slot)["family"]) || fb;
  const voice = obj(guide["voice"]);
  const logos = Array.isArray(brand["logos"]) ? (brand["logos"] as Array<{ id?: string; svg?: string }>) : [];
  const chosen = logos.find((l) => l?.id === brand["chosenLogoId"]) || logos[0];

  return {
    brandName: str(guide["brandName"]) || "Your Product",
    tagline: str(guide["tagline"]),
    pitch: str(answers["pitch"]) || str(answers["what-statement"]),
    positioning: str(guide["positioning"]),
    personality: Array.isArray(guide["personality"])
      ? (guide["personality"] as unknown[]).filter((x): x is string => typeof x === "string")
      : [],
    palette: {
      primary: role("primary", palette[0]?.hex || "#1f3a5f"),
      accent: role("accent|secondary", palette[1]?.hex || "#e8743b"),
      ink: role("ink|text|dark|black", "#16202b"),
      surface: role("surface|background|light|paper|off.?white|cream", "#f7f8fa"),
      muted: role("muted|gray|grey|neutral|border", "#8a9099"),
    },
    displayFont: fontOf(typography["display"], "Inter"),
    bodyFont: fontOf(typography["body"], "Inter"),
    voiceTone: str(voice["tone"]),
    logoSvg: chosen?.svg || undefined,
    pricing: str(answers["pricing-model"]) || undefined,
  };
}

// ---- the site -----------------------------------------------------------------

function indexHtml(spec: StarterSiteSpec, opts: ScaffoldOptions): string {
  const domain = (opts.domain || "https://example.com").replace(/\/+$/, "");
  const founder = opts.founderName || "";
  const social = opts.socialImage || `${domain}/og-image.png`;
  const name = esc(spec.brandName);
  const headline = esc(spec.tagline || spec.brandName);
  const lead = esc(spec.pitch || spec.positioning);
  const desc = esc(spec.pitch || spec.positioning || spec.brandName);
  const fonts = `https://fonts.googleapis.com/css2?family=${fam(spec.displayFont)}:wght@400;600;700;800&family=${fam(spec.bodyFont)}:wght@400;500;600&display=swap`;

  const graph: Array<Record<string, unknown>> = [
    { "@type": "Organization", "@id": `${domain}/#org`, name: spec.brandName, url: `${domain}/`, ...(founder ? { founder: { "@id": `${domain}/#founder` } } : {}) },
    ...(founder ? [{ "@type": "Person", "@id": `${domain}/#founder`, name: founder, worksFor: { "@id": `${domain}/#org` } }] : []),
    { "@type": "WebSite", "@id": `${domain}/#website`, url: `${domain}/`, name: spec.brandName, publisher: { "@id": `${domain}/#org` } },
    { "@type": "WebPage", "@id": `${domain}/#webpage`, url: `${domain}/`, name: `${spec.brandName}${spec.tagline ? " - " + spec.tagline : ""}`, isPartOf: { "@id": `${domain}/#website` }, about: { "@id": `${domain}/#org` }, description: spec.pitch || spec.positioning || spec.brandName },
  ];
  // JSON.stringify does NOT escape < or >, so a value containing "</script>"
  // would break out of the ld+json <script> block. Unicode-escape both.
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": graph })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

  const lockup = spec.logoSvg ? spec.logoSvg : `<span class="wordmark">${name}</span>`;
  const pills = spec.personality.map((t) => `<li class="pill">${esc(t)}</li>`).join("");
  const positioningSection = spec.positioning
    ? `<section class="value" aria-labelledby="value-h"><div class="wrap"><h2 id="value-h">Who it is for</h2><p>${esc(spec.positioning)}</p>${pills ? `<ul class="pills" aria-label="What it stands for">${pills}</ul>` : ""}</div></section>`
    : "";
  const pricingSection = spec.pricing
    ? `<section class="pricing" aria-labelledby="pricing-h"><div class="wrap"><h2 id="pricing-h">Pricing</h2><p class="price">${esc(spec.pricing)}</p></div></section>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}${spec.tagline ? " - " + headline : ""}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${domain}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${name}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${domain}/">
<meta property="og:image" content="${esc(social)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${name}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${esc(social)}">
<link href="${esc(fonts)}" rel="stylesheet">
<script type="application/ld+json">${jsonLd}</script>
<style>
:root{--p:${spec.palette.primary};--a:${spec.palette.accent};--ink:${spec.palette.ink};--su:${spec.palette.surface};--mu:${spec.palette.muted};--disp:'${spec.displayFont}',system-ui,sans-serif;--body:'${spec.bodyFont}',system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--su);color:var(--ink);font-family:var(--body);line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:0 24px}
a{color:var(--a)}
:focus-visible{outline:3px solid var(--a);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
header{padding:24px 0}
header .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px}
.wordmark{font-family:var(--disp);font-weight:800;font-size:22px;color:var(--p)}
.logo svg,.logo img{height:36px;width:auto}
.cta{display:inline-block;background:var(--p);color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px;border:0;cursor:pointer;font-size:15px}
.cta.alt{background:var(--a)}
.hero{padding:72px 0 56px}
.hero h1{font-family:var(--disp);font-weight:800;font-size:clamp(34px,6vw,60px);line-height:1.05;color:var(--ink);letter-spacing:-0.02em;max-width:14ch}
.hero p.lead{font-size:clamp(17px,2.4vw,22px);opacity:.82;margin:20px 0 28px;max-width:42ch}
.signup{display:flex;gap:10px;flex-wrap:wrap;max-width:460px}
.signup input[type=email]{flex:1 1 220px;padding:12px 14px;border:1px solid var(--mu);border-radius:10px;font:inherit;background:#fff;color:var(--ink)}
.value,.pricing{padding:48px 0;border-top:1px solid color-mix(in srgb,var(--mu) 40%,transparent)}
.value h2,.pricing h2{font-family:var(--disp);font-weight:700;font-size:28px;margin-bottom:12px}
.value p{max-width:54ch;opacity:.85}
ul.pills{list-style:none;display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.pill{font-size:13px;font-weight:600;color:var(--p);background:color-mix(in srgb,var(--p) 12%,transparent);padding:6px 14px;border-radius:999px}
.pricing .price{font-family:var(--disp);font-size:24px;font-weight:700;color:var(--p);margin-top:8px}
footer{padding:48px 0;border-top:1px solid color-mix(in srgb,var(--mu) 40%,transparent);color:var(--mu);font-size:13px}
@media (max-width:640px){.hero{padding:48px 0 40px}header .wrap{flex-direction:column;align-items:flex-start}}
</style>
</head>
<body>
<header><div class="wrap"><div class="logo">${lockup}</div><a class="cta" href="#get-started">Get early access</a></div></header>
<main>
<section class="hero" aria-labelledby="hero-h"><div class="wrap">
<h1 id="hero-h">${headline}</h1>
<p class="lead">${lead}</p>
<form name="signups" id="get-started" method="POST" data-netlify="true" class="signup">
<input type="hidden" name="form-name" value="signups">
<label class="sr-only" for="email">Email address</label>
<input id="email" type="email" name="email" placeholder="you@email.com" required>
<button type="submit" class="cta alt">Get early access</button>
</form>
</div></section>
${positioningSection}
${pricingSection}
</main>
<footer><div class="wrap"><p>${name}${founder ? ` - by ${esc(founder)}` : ""}. Scaffolded by The Thought Layer.</p></div></footer>
</body>
</html>
`;
}

function companionFiles(spec: StarterSiteSpec, opts: ScaffoldOptions): Record<string, string> {
  const domain = (opts.domain || "https://example.com").replace(/\/+$/, "");
  const name = spec.brandName;
  const summary = spec.pitch || spec.positioning || name;

  const llms = `# ${name}\n\n> ${summary}\n\n## About\n${name}${spec.tagline ? ` - ${spec.tagline}` : ""}. ${spec.positioning || summary}\n\n## Pages\n- [Home](${domain}/) - ${spec.tagline || summary}\n\n## FAQ\n- What is ${name}? ${summary}\n- Who is it for? ${spec.positioning || "See the home page."}\n`;

  const robots = `User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nSitemap: ${domain}/sitemap.xml\n`;

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${domain}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`;

  const redirects = `/*  /index.html  200\n`;

  const netlifyToml = `[build]\n  publish = "."\n\n[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 200\n`;

  const seoDoc = `# SEO and deployment\n\nThis static site was scaffolded deterministically by The Thought Layer. It is ready to deploy (drag the publish folder onto https://app.netlify.com/drop, or use the deploy step). Everything below is already in place; the lines marked TO FILL need your input.\n\n## In place\n- **Structured data**: schema.org JSON-LD (@graph) with Organization, WebSite, and WebPage in index.html.\n- **/llms.txt**: an AI-crawler summary at the site root.\n- **robots.txt**: allows search + AI crawlers and points to the sitemap.\n- **sitemap.xml**: lists the home page.\n- **Canonical + Open Graph + Twitter Card** meta on the page.\n- **_redirects** and **netlify.toml**: SPA fallback (/* -> /index.html).\n- **Email capture**: a Netlify Forms signup ("signups") - submissions appear in your Netlify dashboard after deploy, no backend needed.\n- Semantic, accessible HTML (landmarks, heading order, labelled form, visible focus).\n\n## TO FILL\n- **Domain**: replace ${domain} with your real domain in index.html (canonical/OG), llms.txt, robots.txt, sitemap.xml. Pass --domain to the scaffold tool to set it up front.\n- **Founder + sameAs**: add a Person with real sameAs profile links (LinkedIn, X) to the JSON-LD, and cross-reference the Organization. Pass --founder to seed the name.\n- **Social image**: add a 1200x630 image at /og-image.png (referenced by og:image / twitter:image).\n- **The product**: this is a landing/coming-soon page. Build the actual product with the thought-layer-build skill (/tl-build).\n`;

  return {
    "llms.txt": llms,
    "robots.txt": robots,
    "sitemap.xml": sitemap,
    "_redirects": redirects,
    "netlify.toml": netlifyToml,
    "SEO.md": seoDoc,
  };
}

export function buildStarterSite(spec: StarterSiteSpec, opts: ScaffoldOptions = {}): { files: Record<string, string> } {
  return { files: { "index.html": indexHtml(spec, opts), ...companionFiles(spec, opts) } };
}

// ---- the manifest (scaffold producer) ----------------------------------------

export function scaffoldManifest(
  publishDir: string,
  builtAt: string,
  provenance: { stateFile: string; prdTs: number | null; grillDone: boolean; fromSpeedrun: boolean },
): BuildManifest {
  return {
    app: "thought-layer",
    kind: "build",
    version: 1,
    builtAt,
    producer: "scaffold",
    publishDir,
    entry: "index.html",
    stack: "static",
    hasBackend: false,
    backendNote: null,
    backend: null,
    buildCommand: null,
    installCommand: null,
    nodeVersion: "20",
    provenance,
    requirements: { total: 0, built: 0, deferred: 0, deferredIds: [] },
    seo: { jsonLd: true, llmsTxt: true, sitemap: true, robots: true, canonical: true, openGraph: true, socialImage: false, semanticHtml: true, seoDoc: true, netlifyToml: true },
    artifacts: { traceability: null, decisions: null, seo: "SEO.md" },
    verified: { buildRan: true, publishDirExists: true, entryLoads: true, notes: "deterministic static scaffold; landing page + SEO files written" },
  };
}
